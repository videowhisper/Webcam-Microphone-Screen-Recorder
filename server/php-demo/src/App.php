<?php
declare(strict_types=1);

namespace VideoWhisper\RecorderDemo;

use PDO;
use Throwable;

final class App
{
    private PDO $db;
    private array $config;

    public function __construct(array $config)
    {
        $this->config = $this->validateConfig($config);
        $this->ensureDirectories();
        $this->db = $this->createDatabase();
        $this->migrate();
    }

    public function handle(): void
    {
        $this->headers();
        session_start();
        $this->ensureOwnerCookie();
        $this->opportunisticCleanup();

        $path = $this->requestPath();
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

        try {
            if ($path === null) {
                http_response_code(404);
                echo 'Not found';
                return;
            }
            if ($path === '/' && $method === 'GET') {
                $this->renderHome();
                return;
            }
            if ($path === '/capabilities' && $method === 'GET') {
                $this->json(['ok' => true, 'php' => $this->diagnostics()]);
                return;
            }
            if ($path === '/uploads' && $method === 'POST') {
                $this->handleUpload();
                return;
            }
            if ($path === '/items' && $method === 'GET') {
                $this->requireAdmin();
                $this->json(['ok' => true, 'items' => $this->listMedia()]);
                return;
            }
            if (preg_match('#^/items/([a-f0-9]{24})$#', $path, $matches) && $method === 'DELETE') {
                $this->requireAdmin();
                $this->deleteMedia($matches[1]);
                $this->json(['ok' => true]);
                return;
            }
            if ($path === '/media' && $method === 'GET') {
                $this->serveMedia();
                return;
            }
            if ($path === '/admin/login' && $method === 'GET') {
                $this->renderLogin();
                return;
            }
            if ($path === '/admin/login' && $method === 'POST') {
                $this->handleLogin();
                return;
            }
            if ($path === '/admin/logout' && $method === 'POST') {
                $this->checkCsrf();
                $_SESSION = [];
                session_destroy();
                $this->redirect('/admin/login');
                return;
            }
            if ($path === '/admin/media' && $method === 'GET') {
                $this->requireAdmin();
                $this->renderMediaList();
                return;
            }
            if ($path === '/admin/diagnostics' && $method === 'GET') {
                $this->requireAdmin();
                $this->renderDiagnostics();
                return;
            }
            if ($path === '/admin/cleanup' && $method === 'POST') {
                $this->requireAdmin();
                $this->checkCsrf();
                $summary = $this->cleanup();
                $this->renderDiagnostics($summary);
                return;
            }

            http_response_code(404);
            echo 'Not found';
        } catch (Throwable $throwable) {
            $this->log('error', $throwable->getMessage());
            if (in_array($path, ['/capabilities', '/uploads', '/items'], true) || str_starts_with($path, '/items/')) {
                http_response_code(500);
                $this->json(['ok' => false, 'error' => 'Server error.']);
                return;
            }
            http_response_code(500);
            echo 'Server error.';
        }
    }

    public function cleanup(): array
    {
        $lockPath = $this->config['log_path'] . '/cleanup.lock';
        $lock = fopen($lockPath, 'c');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            return ['deleted' => 0, 'skipped' => 'cleanup already running'];
        }

        $deleted = 0;
        $maxAge = min((int) $this->config['retention']['max_age_days'], 365);
        $cutoff = gmdate('c', time() - ($maxAge * DAY_IN_SECONDS));
        $absoluteCutoff = gmdate('c', time() - (365 * DAY_IN_SECONDS));

        $stmt = $this->db->prepare('SELECT id FROM media WHERE created_at < :cutoff OR created_at < :absolute_cutoff');
        $stmt->execute([':cutoff' => $cutoff, ':absolute_cutoff' => $absoluteCutoff]);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $id) {
            $this->deleteMedia((string) $id);
            $deleted++;
        }

        foreach ($this->config['uploads']['allowed_types'] as $type) {
            $stmt = $this->db->prepare('SELECT id FROM media WHERE type = :type ORDER BY created_at DESC');
            $stmt->execute([':type' => $type]);
            $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
            $keep = (int) $this->config['retention']['max_items_per_type'];
            foreach (array_slice($ids, $keep) as $id) {
                $this->deleteMedia((string) $id);
                $deleted++;
            }
        }

        $summary = ['deleted' => $deleted, 'finished_at' => gmdate('c')];
        $this->log('cleanup', json_encode($summary, JSON_UNESCAPED_SLASHES) ?: '{}');
        flock($lock, LOCK_UN);
        fclose($lock);

        return $summary;
    }

    private function validateConfig(array $config): array
    {
        $config['base_path'] = $this->normalizeBasePath((string) ($config['base_path'] ?? '/'));
        $config['retention']['max_age_days'] = min(max((int) $config['retention']['max_age_days'], 1), 365);
        $config['retention']['absolute_max_age_days'] = 365;
        $config['uploads']['max_bytes'] = min((int) $config['uploads']['max_bytes'], 100 * 1024 * 1024);
        return $config;
    }

    private function requestPath(): ?string
    {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $basePath = $this->config['base_path'];
        if ($basePath !== '/') {
            if ($path === $basePath) {
                return '/';
            }
            if (!str_starts_with($path, $basePath . '/')) {
                return null;
            }
            $path = substr($path, strlen($basePath));
        }

        // Backward-compatible direct-development aliases. The deployment
        // package uses its /api directory as the base path instead.
        if ($basePath === '/' && str_starts_with($path, '/api/')) {
            $path = substr($path, 4);
        }
        return $path === '' ? '/' : $path;
    }

    private function url(string $path): string
    {
        $basePath = $this->config['base_path'];
        if ($path === '/') {
            return $basePath === '/' ? '/' : $basePath . '/';
        }
        return ($basePath === '/' ? '' : $basePath) . '/' . ltrim($path, '/');
    }

    private function normalizeBasePath(string $path): string
    {
        $normalized = '/' . trim($path, '/');
        return $normalized === '/' ? '/' : $normalized;
    }

    private function headers(): void
    {
        header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; media-src 'self' blob:; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'self'");
        header('Referrer-Policy: same-origin');
    }

    private function ensureDirectories(): void
    {
        foreach (['storage_path', 'thumbnail_path', 'log_path'] as $key) {
            if (!is_dir($this->config[$key])) {
                mkdir($this->config[$key], 0755, true);
            }
        }
    }

    private function createDatabase(): PDO
    {
        $path = $this->config['database']['path'];
        if (!is_dir(dirname($path))) {
            mkdir(dirname($path), 0755, true);
        }
        $pdo = new PDO('sqlite:' . $path);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        return $pdo;
    }

    private function migrate(): void
    {
        $this->db->exec(
            'CREATE TABLE IF NOT EXISTS media (
                id TEXT PRIMARY KEY,
                owner_hash TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                file_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                duration_seconds REAL NULL,
                width INTEGER NULL,
                height INTEGER NULL,
                audio_present INTEGER NOT NULL DEFAULT 0,
                source_path TEXT NOT NULL,
                thumbnail_path TEXT NULL,
                metadata_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )'
        );
        $this->db->exec('CREATE INDEX IF NOT EXISTS media_created_idx ON media(created_at)');
        $this->db->exec('CREATE INDEX IF NOT EXISTS media_type_idx ON media(type)');
    }

    private function handleUpload(): void
    {
        $this->checkUploadLimit();
        $ownerHash = $this->ownerHash();
        $file = $_FILES['media'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            http_response_code(400);
            $this->json(['ok' => false, 'error' => 'No upload was received.']);
            return;
        }

        $size = (int) $file['size'];
        if ($size < 1 || $size > (int) $this->config['uploads']['max_bytes']) {
            http_response_code(413);
            $this->json(['ok' => false, 'error' => 'Uploaded file is too large.']);
            return;
        }

        $metadata = $this->sanitizeMetadata($this->decodeMetadata($_POST['metadata'] ?? '{}'));
        $type = $this->sanitizeType((string) ($metadata['type'] ?? 'video'));
        if (!in_array($type, $this->config['uploads']['allowed_types'], true)) {
            http_response_code(400);
            $this->json(['ok' => false, 'error' => 'Media type is not allowed.']);
            return;
        }

        $mime = $this->detectMime((string) $file['tmp_name']);
        if (!$this->mimeAllowedForType($mime, $type)) {
            http_response_code(400);
            $this->json(['ok' => false, 'error' => 'Uploaded media format is not allowed.']);
            return;
        }

        $id = bin2hex(random_bytes(12));
        $extension = $this->extensionForMime($mime);
        $fileName = $this->buildStoredFileName($id, $type, $extension, $metadata);
        $destination = $this->config['storage_path'] . '/' . $fileName;
        if (!move_uploaded_file((string) $file['tmp_name'], $destination)) {
            http_response_code(500);
            $this->json(['ok' => false, 'error' => 'Upload could not be stored.']);
            return;
        }

        $thumbnailPath = null;
        if (isset($_FILES['thumbnail']) && is_array($_FILES['thumbnail']) && ($_FILES['thumbnail']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
            $thumbMime = $this->detectMime((string) $_FILES['thumbnail']['tmp_name']);
            if (in_array($thumbMime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
                $thumbName = $id . '-thumbnail.' . $this->extensionForMime($thumbMime);
                $thumbnailPath = $this->config['thumbnail_path'] . '/' . $thumbName;
                move_uploaded_file((string) $_FILES['thumbnail']['tmp_name'], $thumbnailPath);
            }
        }

        $stmt = $this->db->prepare(
            'INSERT INTO media (id, owner_hash, type, status, file_name, mime_type, size_bytes, duration_seconds, width, height, audio_present, source_path, thumbnail_path, metadata_json, created_at)
            VALUES (:id, :owner_hash, :type, :status, :file_name, :mime_type, :size_bytes, :duration_seconds, :width, :height, :audio_present, :source_path, :thumbnail_path, :metadata_json, :created_at)'
        );
        $stmt->execute([
            ':id' => $id,
            ':owner_hash' => $ownerHash,
            ':type' => $type,
            ':status' => 'ready',
            ':file_name' => $fileName,
            ':mime_type' => $mime,
            ':size_bytes' => $size,
            ':duration_seconds' => $this->nullableFloat($metadata['durationSeconds'] ?? null),
            ':width' => $this->nullableInt($metadata['width'] ?? null),
            ':height' => $this->nullableInt($metadata['height'] ?? null),
            ':audio_present' => !empty($metadata['audioPresent']) ? 1 : 0,
            ':source_path' => $destination,
            ':thumbnail_path' => $thumbnailPath,
            ':metadata_json' => json_encode($metadata, JSON_UNESCAPED_SLASHES) ?: '{}',
            ':created_at' => gmdate('c'),
        ]);

        $this->json([
            'ok' => true,
            'uploadId' => $id,
            'serverMediaId' => $id,
            'status' => 'ready',
            'remoteUrl' => $this->url('/media?id=' . rawurlencode($id)),
            'playbackUrl' => $this->url('/media?id=' . rawurlencode($id)),
            'thumbnailUrl' => $thumbnailPath ? $this->url('/media?id=' . rawurlencode($id) . '&kind=thumbnail') : null,
            'metadata' => ['storedFileName' => $fileName],
        ]);
    }

    private function serveMedia(): void
    {
        $id = preg_replace('/[^a-f0-9]/', '', (string) ($_GET['id'] ?? ''));
        $kind = ($_GET['kind'] ?? 'source') === 'thumbnail' ? 'thumbnail' : 'source';
        if (strlen($id) !== 24) {
            http_response_code(404);
            return;
        }

        $stmt = $this->db->prepare('SELECT * FROM media WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            http_response_code(404);
            return;
        }

        if (!$this->isAdmin() && !hash_equals((string) $row['owner_hash'], $this->ownerHash())) {
            http_response_code(403);
            return;
        }

        $path = $kind === 'thumbnail' ? (string) ($row['thumbnail_path'] ?? '') : (string) $row['source_path'];
        if (!$path || !is_file($path)) {
            http_response_code(404);
            return;
        }

        header('Content-Type: ' . ($kind === 'thumbnail' ? $this->detectMime($path) : $row['mime_type']));
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: inline; filename="' . $this->escapeHeaderFileName((string) $row['file_name']) . '"');
        readfile($path);
    }

    private function renderHome(): void
    {
        $this->htmlStart('VideoWhisper Recorder Demo');
        echo '<main class="wrap"><h1>VideoWhisper Recorder PHP Demo</h1>';
        echo '<p>Run the Vite Free demo for the recorder UI, or use this PHP backend for uploads and admin browsing.</p>';
        echo '<p><a href="' . esc($this->url('/admin/media')) . '">Admin media browser</a> · <a href="' . esc($this->url('/admin/diagnostics')) . '">Diagnostics</a></p></main>';
        $this->htmlEnd();
    }

    private function renderLogin(): void
    {
        $this->htmlStart('Recorder Admin Login');
        echo '<main class="wrap"><h1>Admin login</h1><form method="post" action="' . esc($this->url('/admin/login')) . '">';
        echo '<input type="hidden" name="csrf" value="' . esc($this->csrf()) . '">';
        echo '<label>Username <input name="username" autocomplete="username"></label>';
        echo '<label>Password <input name="password" type="password" autocomplete="current-password"></label>';
        echo '<button type="submit">Login</button></form></main>';
        $this->htmlEnd();
    }

    private function handleLogin(): void
    {
        $this->checkCsrf();
        $username = (string) ($_POST['username'] ?? '');
        $password = (string) ($_POST['password'] ?? '');
        if (hash_equals((string) $this->config['admin']['username'], $username) && hash_equals((string) $this->config['admin']['password'], $password)) {
            session_regenerate_id(true);
            $_SESSION['vwr_admin'] = true;
            $this->redirect('/admin/media');
            return;
        }
        http_response_code(403);
        $this->renderLogin();
    }

    private function renderMediaList(): void
    {
        $items = $this->listMedia();
        $this->htmlStart('Recorder Media');
        echo '<main class="wrap"><div class="top"><h1>Media</h1><form method="post" action="' . esc($this->url('/admin/logout')) . '"><input type="hidden" name="csrf" value="' . esc($this->csrf()) . '"><button>Logout</button></form></div>';
        echo '<p><a href="' . esc($this->url('/admin/diagnostics')) . '">Diagnostics and cleanup</a></p>';
        echo '<table><thead><tr><th>Preview</th><th>Type</th><th>Details</th><th>Created</th><th></th></tr></thead><tbody>';
        foreach ($items as $item) {
            $id = esc($item['id']);
            echo '<tr>';
            echo '<td><a href="' . esc($this->url('/media?id=' . $id)) . '">';
            if (!empty($item['thumbnail_path'])) {
                echo '<img class="thumb" src="' . esc($this->url('/media?id=' . $id . '&kind=thumbnail')) . '" alt="">';
            } else {
                echo esc((string) $item['type']);
            }
            echo '</a></td>';
            echo '<td>' . esc((string) $item['type']) . '</td>';
            echo '<td>' . $this->mediaDetailsHtml($item) . '</td>';
            echo '<td>' . esc((string) $item['created_at']) . '</td>';
            echo '<td><button data-delete="' . $id . '">Delete</button></td>';
            echo '</tr>';
        }
        echo '</tbody></table>';
        $this->renderCredentialHelp();
        echo '</main>';
        echo '<script>document.querySelectorAll("[data-delete]").forEach(function(button){button.addEventListener("click",function(){if(confirm("Delete this media?"))fetch(' . json_encode($this->url('/items/')) . '+button.dataset.delete,{method:"DELETE"}).then(function(){location.reload();});});});</script>';
        $this->htmlEnd();
    }

    private function renderCredentialHelp(): void
    {
        $usesDefaultAdmin = $this->config['admin']['username'] === 'admin' && $this->config['admin']['password'] === 'admin';
        $usesDefaultHmac = $this->config['security']['hmac_secret'] === 'change-this-recorder-demo-secret';
        $className = $usesDefaultAdmin || $usesDefaultHmac ? 'credential-help is-warning' : 'credential-help';
        $snippet = <<<'PHP'
<?php
return [
    'admin_username' => 'your-private-admin-name',
    'admin_password' => 'your-long-random-password',
    'hmac_secret' => 'your-long-random-secret',
];
PHP;

        $summary = $usesDefaultAdmin || $usesDefaultHmac ? 'Security warning: change default credentials' : 'Admin credential settings';
        echo '<details class="' . esc($className) . '"><summary>' . esc($summary) . '</summary><div class="credential-help-body">';
        if ($usesDefaultAdmin || $usesDefaultHmac) {
            echo '<p><strong>Action required:</strong> one or more local default credentials are active. Do not expose this installation publicly.</p>';
        } else {
            echo '<p>Custom credentials are active.</p>';
        }
        echo '<p>Copy <code>config/credentials.example.php</code> to <code>config/credentials.php</code>, replace every value, and keep that file outside the <code>public/</code> document root and source control:</p>';
        echo '<pre>' . esc($snippet) . '</pre>';
        echo '<p>Alternatively set <code>VW_RECORDER_ADMIN_USER</code>, <code>VW_RECORDER_ADMIN_PASSWORD</code>, and <code>VW_RECORDER_HMAC_SECRET</code>; environment variables override the file. Log out and sign in with the new admin credentials. Keep the HMAC secret stable because changing it invalidates existing anonymous owner cookies.</p></div></details>';
    }

    private function mediaDetailsHtml(array $item): string
    {
        $lines = [
            (string) $item['file_name'],
            (string) $item['mime_type'],
            (string) $item['size_bytes'] . ' bytes',
        ];
        if (is_numeric($item['duration_seconds'] ?? null)) {
            $lines[] = rtrim(rtrim(number_format((float) $item['duration_seconds'], 2, '.', ''), '0'), '.') . ' seconds';
        }
        if (!empty($item['width']) && !empty($item['height'])) {
            $lines[] = (int) $item['width'] . '×' . (int) $item['height'];
        }

        $metadata = json_decode((string) ($item['metadata_json'] ?? '{}'), true);
        if (is_array($metadata)) {
            $mediaInfo = is_array($metadata['mediaInfo'] ?? null) ? $metadata['mediaInfo'] : [];
            $videoInfo = is_array($mediaInfo['video'] ?? null) ? $mediaInfo['video'] : [];
            $encodingInfo = is_array($mediaInfo['encoding'] ?? null) ? $mediaInfo['encoding'] : [];
            $frameRate = $metadata['frameRate'] ?? $videoInfo['frameRate'] ?? null;
            if (is_numeric($frameRate)) {
                $lines[] = rtrim(rtrim(number_format((float) $frameRate, 2, '.', ''), '0'), '.') . ' fps';
            }
            if (is_numeric($videoInfo['rotationDegrees'] ?? null)) {
                $lines[] = (float) $videoInfo['rotationDegrees'] . '° rotation';
            }
            $bitrates = [];
            if (is_numeric($encodingInfo['videoBitsPerSecond'] ?? null)) {
                $bitrates[] = 'video ' . round((float) $encodingInfo['videoBitsPerSecond'] / 1000) . ' kbps';
            }
            if (is_numeric($encodingInfo['audioBitsPerSecond'] ?? null)) {
                $bitrates[] = 'audio ' . round((float) $encodingInfo['audioBitsPerSecond'] / 1000) . ' kbps';
            }
            if ($bitrates !== []) {
                $lines[] = 'Encoding: ' . implode(', ', $bitrates);
            }
            $codecs = $mediaInfo['codecs'] ?? [];
            if (is_array($codecs) && $codecs !== []) {
                $lines[] = 'Codecs: ' . implode(', ', array_map('strval', array_slice($codecs, 0, 6)));
            }
        }

        return implode('<br>', array_map(static fn (string $line): string => esc($line), $lines));
    }

    private function renderDiagnostics(?array $summary = null): void
    {
        $this->htmlStart('Recorder Diagnostics');
        echo '<main class="wrap"><h1>Diagnostics</h1><pre>' . esc(json_encode($this->diagnostics(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) ?: '{}') . '</pre>';
        if ($summary) {
            echo '<h2>Cleanup summary</h2><pre>' . esc(json_encode($summary, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) ?: '{}') . '</pre>';
        }
        echo '<form method="post" action="' . esc($this->url('/admin/cleanup')) . '"><input type="hidden" name="csrf" value="' . esc($this->csrf()) . '"><button>Run cleanup</button></form>';
        echo '<p><a href="' . esc($this->url('/admin/media')) . '">Back to media</a></p></main>';
        $this->htmlEnd();
    }

    private function listMedia(): array
    {
        return $this->db->query('SELECT * FROM media ORDER BY created_at DESC LIMIT 200')->fetchAll();
    }

    private function deleteMedia(string $id): void
    {
        $stmt = $this->db->prepare('SELECT source_path, thumbnail_path FROM media WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if ($row) {
            foreach (['source_path', 'thumbnail_path'] as $key) {
                $path = (string) ($row[$key] ?? '');
                if ($path && is_file($path) && $this->isInsideStorage($path)) {
                    unlink($path);
                }
            }
        }
        $delete = $this->db->prepare('DELETE FROM media WHERE id = :id');
        $delete->execute([':id' => $id]);
    }

    private function diagnostics(): array
    {
        return [
            'php_version' => PHP_VERSION,
            'sqlite' => extension_loaded('pdo_sqlite'),
            'fileinfo' => extension_loaded('fileinfo'),
            'upload_max_filesize' => ini_get('upload_max_filesize'),
            'post_max_size' => ini_get('post_max_size'),
            'storage_writable' => is_writable($this->config['storage_path']),
            'thumbnail_writable' => is_writable($this->config['thumbnail_path']),
            'retention' => $this->config['retention'],
            'ffmpeg' => trim((string) shell_exec('command -v ffmpeg 2>/dev/null')) ?: null,
        ];
    }

    private function opportunisticCleanup(): void
    {
        if (empty($this->config['retention']['enabled'])) {
            return;
        }
        $probability = (float) $this->config['cleanup']['run_probability'];
        if ($probability <= 0 || mt_rand() / mt_getrandmax() > $probability) {
            return;
        }
        $lastPath = $this->config['log_path'] . '/cleanup-last.txt';
        $minimum = (int) $this->config['cleanup']['minimum_interval_minutes'] * 60;
        if (is_file($lastPath) && (time() - (int) file_get_contents($lastPath)) < $minimum) {
            return;
        }
        file_put_contents($lastPath, (string) time());
        $this->cleanup();
    }

    private function ensureOwnerCookie(): void
    {
        $name = $this->config['security']['cookie_name'];
        $cookie = (string) ($_COOKIE[$name] ?? '');
        if ($cookie && $this->verifyOwnerCookie($cookie)) {
            return;
        }
        $ownerId = bin2hex(random_bytes(16));
        $issued = (string) time();
        $signature = hash_hmac('sha256', $ownerId . '.' . $issued, (string) $this->config['security']['hmac_secret']);
        setcookie($name, $ownerId . '.' . $issued . '.' . $signature, [
            'expires' => time() + (366 * DAY_IN_SECONDS),
            'path' => (string) $this->config['security']['cookie_path'],
            'secure' => !empty($_SERVER['HTTPS']),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        $_COOKIE[$name] = $ownerId . '.' . $issued . '.' . $signature;
    }

    private function verifyOwnerCookie(string $cookie): bool
    {
        $parts = explode('.', $cookie);
        if (count($parts) !== 3) {
            return false;
        }
        [$ownerId, $issued, $signature] = $parts;
        if (!ctype_xdigit($ownerId) || !ctype_digit($issued)) {
            return false;
        }
        $expected = hash_hmac('sha256', $ownerId . '.' . $issued, (string) $this->config['security']['hmac_secret']);
        return hash_equals($expected, $signature);
    }

    private function ownerHash(): string
    {
        $name = $this->config['security']['cookie_name'];
        $cookie = (string) ($_COOKIE[$name] ?? '');
        if (!$this->verifyOwnerCookie($cookie)) {
            $this->ensureOwnerCookie();
            $cookie = (string) ($_COOKIE[$name] ?? '');
        }
        $ownerId = explode('.', $cookie)[0] ?? '';
        return hash('sha256', $ownerId . (string) $this->config['security']['hmac_secret']);
    }

    private function csrf(): string
    {
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
        }
        return (string) $_SESSION['csrf'];
    }

    private function checkCsrf(): void
    {
        $token = (string) ($_POST['csrf'] ?? $_POST['csrfToken'] ?? '');
        if (!hash_equals($this->csrf(), $token)) {
            http_response_code(403);
            throw new \RuntimeException('Invalid CSRF token.');
        }
    }

    private function requireAdmin(): void
    {
        if (!$this->isAdmin()) {
            $this->redirect('/admin/login');
        }
    }

    private function isAdmin(): bool
    {
        return !empty($_SESSION['vwr_admin']);
    }

    private function checkUploadLimit(): void
    {
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > (int) $this->config['uploads']['max_bytes'] + 1024 * 1024) {
            http_response_code(413);
            $this->json(['ok' => false, 'error' => 'Request body is too large.']);
            exit;
        }
    }

    private function decodeMetadata(mixed $metadata): array
    {
        if (!is_string($metadata) || strlen($metadata) > 65536) {
            return [];
        }
        $decoded = json_decode($metadata, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function sanitizeMetadata(array $metadata): array
    {
        $clean = [];
        foreach (array_slice($metadata, 0, 100, true) as $key => $value) {
            $cleanKey = preg_replace('/[^a-zA-Z0-9_.:-]/', '', (string) $key);
            if ($cleanKey === '') {
                continue;
            }
            $clean[$cleanKey] = $this->sanitizeMetadataValue($value, 1);
        }
        return $clean;
    }

    private function sanitizeMetadataValue(mixed $value, int $depth): mixed
    {
        if ($value === null || is_bool($value) || is_int($value) || is_float($value)) {
            return $value;
        }
        if (is_string($value)) {
            return mb_substr($value, 0, 500);
        }
        if (!is_array($value) || $depth > 5) {
            return null;
        }

        if (array_is_list($value)) {
            return array_map(
                fn (mixed $item): mixed => $this->sanitizeMetadataValue($item, $depth + 1),
                array_slice($value, 0, 50)
            );
        }

        $clean = [];
        foreach (array_slice($value, 0, 100, true) as $key => $item) {
            $cleanKey = preg_replace('/[^a-zA-Z0-9_.:-]/', '', (string) $key);
            if ($cleanKey !== '') {
                $clean[$cleanKey] = $this->sanitizeMetadataValue($item, $depth + 1);
            }
        }
        return $clean;
    }

    private function sanitizeType(string $type): string
    {
        if ($type === 'screen-camera') {
            return 'screen';
        }
        return preg_replace('/[^a-z-]/', '', $type) ?: 'video';
    }

    private function detectMime(string $path): string
    {
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        return $finfo->file($path) ?: 'application/octet-stream';
    }

    private function mimeAllowedForType(string $mime, string $type): bool
    {
        return match ($type) {
            'audio' => str_starts_with($mime, 'audio/') || $mime === 'video/webm',
            'photo', 'screenshot' => in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true),
            default => str_starts_with($mime, 'video/'),
        };
    }

    private function extensionForMime(string $mime): string
    {
        return match ($mime) {
            'video/mp4' => 'mp4',
            'video/webm', 'audio/webm' => 'webm',
            'audio/mpeg' => 'mp3',
            'audio/mp4' => 'm4a',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/jpeg' => 'jpg',
            default => 'bin',
        };
    }

    private function buildStoredFileName(string $id, string $type, string $extension, array $metadata): string
    {
        $parts = [$type];
        $duration = $this->nullableFloat($metadata['durationSeconds'] ?? null);
        if ($type !== 'photo' && $type !== 'screenshot' && $duration !== null && $duration > 0 && $duration <= 86400) {
            $parts[] = max(1, (int) round($duration)) . 's';
        }

        $width = $this->nullableInt($metadata['width'] ?? null);
        $height = $this->nullableInt($metadata['height'] ?? null);
        if ($width !== null && $height !== null && $width > 0 && $height > 0 && $width <= 16384 && $height <= 16384) {
            $parts[] = $width . 'x' . $height;
        }

        $parts[] = $id;
        return implode('-', $parts) . '.' . $extension;
    }

    private function nullableFloat(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }

    private function nullableInt(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    private function isInsideStorage(string $path): bool
    {
        $real = realpath($path);
        if (!$real) {
            return false;
        }
        foreach (['storage_path', 'thumbnail_path'] as $key) {
            $base = realpath($this->config[$key]);
            if ($base && str_starts_with($real, $base . DIRECTORY_SEPARATOR)) {
                return true;
            }
        }
        return false;
    }

    private function escapeHeaderFileName(string $fileName): string
    {
        return str_replace(['"', "\r", "\n"], '', $fileName);
    }

    private function json(array $data): void
    {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_SLASHES);
    }

    private function redirect(string $path): never
    {
        header('Location: ' . $this->url($path), true, 302);
        exit;
    }

    private function htmlStart(string $title): void
    {
        echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
        echo '<title>' . esc($title) . '</title><style>body{font-family:system-ui,sans-serif;background:#e9e6e0;color:#1c1b19;margin:0}.wrap{max-width:1040px;margin:0 auto;padding:32px}.top{display:flex;justify-content:space-between;gap:16px}.credential-help{background:#fff;border:1px solid #d8d4cc;border-radius:8px;margin:18px 0}.credential-help.is-warning{background:#fff7e6;border-color:#d99a22}.credential-help summary{cursor:pointer;font-weight:700;padding:12px 16px}.credential-help-body{border-top:1px solid #d8d4cc;padding:4px 16px 16px}.credential-help code{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;background:#fff}td,th{border:1px solid #e0dcd4;padding:10px;text-align:left}label{display:grid;gap:4px;margin:12px 0}input{min-height:36px;padding:6px 8px}button,a{font:inherit}.thumb{height:64px;max-width:96px;object-fit:cover}pre{background:#fff;border:1px solid #e0dcd4;padding:16px;overflow:auto}</style></head><body>';
    }

    private function htmlEnd(): void
    {
        echo '</body></html>';
    }

    private function log(string $channel, string $message): void
    {
        file_put_contents($this->config['log_path'] . '/' . $channel . '.log', '[' . gmdate('c') . '] ' . $message . PHP_EOL, FILE_APPEND);
    }
}

function esc(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

const DAY_IN_SECONDS = 86400;
