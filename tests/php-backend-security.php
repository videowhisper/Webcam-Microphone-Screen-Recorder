<?php
declare(strict_types=1);

require __DIR__ . '/../server/php-demo/src/App.php';
$config = require __DIR__ . '/../server/php-demo/config/config.php';
$temp = sys_get_temp_dir() . '/recorder-security-' . bin2hex(random_bytes(8));
mkdir($temp, 0700);
foreach (['media', 'thumbnails', 'logs'] as $directory) mkdir($temp . '/' . $directory, 0700);
$config['storage_path'] = $temp . '/media';
$config['thumbnail_path'] = $temp . '/thumbnails';
$config['log_path'] = $temp . '/logs';
$config['database']['path'] = $temp . '/database.sqlite';
$config['retention']['max_age_days'] = 1;
$config['retention']['max_items_per_type'] = 1;
$config['retention']['protected_ids'] = ['historical', 'protected-recent'];
$config['admin'] = ['username' => 'fixture', 'password' => bin2hex(random_bytes(20))];
$config['security']['hmac_secret'] = bin2hex(random_bytes(32));
$check = static function (bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
};

try {
    $app = new VideoWhisper\RecorderDemo\App($config);
    $db = new PDO('sqlite:' . $config['database']['path']);
    $dates = [
        'historical' => '2000-01-01T00:00:00+00:00',
        'protected-recent' => gmdate('c', time() + 10),
        'expired' => '2000-01-01T00:00:00+00:00',
        'extra' => gmdate('c', time() - 10),
        'new' => gmdate('c'),
    ];
    foreach ($dates as $id => $date) {
        $file = $temp . '/media/' . $id;
        file_put_contents($file, 'synthetic');
        $insert = $db->prepare('INSERT INTO media(id,owner_hash,type,status,file_name,mime_type,size_bytes,audio_present,source_path,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
        $insert->execute([$id, 'fixture', 'photo', 'ready', $id, 'image/png', 9, 0, $file, '{}', $date]);
    }
    $before = $db->query("SELECT * FROM media WHERE id = 'historical'")->fetch(PDO::FETCH_ASSOC);
    $check($app->cleanup()['deleted'] === 2, 'Age/count cleanup must remove only expired/excess unprotected items.');
    $check($app->cleanup()['deleted'] === 0, 'Repeated cleanup must be idempotent.');
    $check($db->query("SELECT * FROM media WHERE id = 'historical'")->fetch(PDO::FETCH_ASSOC) === $before, 'Protected historical metadata changed.');
    $check(file_get_contents($temp . '/media/historical') === 'synthetic' && is_file($temp . '/media/protected-recent') && is_file($temp . '/media/new'), 'Protected or newest media removed; protected items must not consume the count quota.');

    $isAdmin = new ReflectionMethod($app, 'isAdmin');
    $_SESSION = ['vwr_admin' => true];
    $check(!$isAdmin->invoke($app), 'Legacy administrator session accepted.');
    $_SESSION['vwr_admin_proof'] = hash_hmac('sha256', $config['admin']['username'] . chr(0) . $config['admin']['password'], $config['security']['hmac_secret']);
    $check($isAdmin->invoke($app), 'Current administrator proof rejected.');
    foreach (['password', 'hmac'] as $rotation) {
        $rotated = $config;
        if ($rotation === 'password') $rotated['admin']['password'] = 'rotated-fixture';
        else $rotated['security']['hmac_secret'] = 'rotated-fixture';
        $check(!$isAdmin->invoke(new VideoWhisper\RecorderDemo\App($rotated)), 'Rotated credentials retained an old administrator session.');
    }
    echo "PASS: age/count retention, historical preservation, repeated cleanup and administrator session rotation.\n";
} finally {
    unset($app, $db, $insert);
    $_SESSION = [];
    // Remove only this isolated, randomly named fixture directory.
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($temp, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($files as $file) {
        if ($file->isDir()) rmdir($file->getPathname());
        else unlink($file->getPathname());
    }
    rmdir($temp);
}
