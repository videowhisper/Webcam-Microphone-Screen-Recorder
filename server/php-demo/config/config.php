<?php
declare(strict_types=1);

$credentialsPath = __DIR__ . '/credentials.php';
$credentials = [];
if (is_file($credentialsPath)) {
    $loadedCredentials = require $credentialsPath;
    if (!is_array($loadedCredentials)) {
        throw new RuntimeException('Recorder credentials file must return an array.');
    }
    $credentials = $loadedCredentials;
}

$credential = static function (string $environmentName, string $fileKey, string $default) use ($credentials): string {
    $environmentValue = getenv($environmentName);
    if (is_string($environmentValue) && $environmentValue !== '') {
        return $environmentValue;
    }

    $fileValue = $credentials[$fileKey] ?? null;
    return is_string($fileValue) && $fileValue !== '' ? $fileValue : $default;
};

$normalizeBasePath = static function (string $value): string {
    $path = '/' . trim($value, '/');
    return $path === '/' ? '/' : $path;
};

$scriptDirectory = dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'));
$basePath = $normalizeBasePath((string) (getenv('VW_RECORDER_BASE_PATH') ?: $scriptDirectory));

return [
    'app_url' => getenv('VW_RECORDER_APP_URL') ?: 'http://127.0.0.1:8080',
    'base_path' => $basePath,
    'edition' => 'free',
    'storage_path' => __DIR__ . '/../storage/media',
    'thumbnail_path' => __DIR__ . '/../storage/thumbnails',
    'log_path' => __DIR__ . '/../storage/logs',
    'database' => [
        'driver' => 'sqlite',
        'path' => __DIR__ . '/../storage/database.sqlite',
    ],
    'uploads' => [
        'max_bytes' => 100 * 1024 * 1024,
        'allowed_types' => ['video', 'audio', 'screen', 'photo', 'screenshot'],
    ],
    'retention' => [
        'enabled' => true,
        'max_age_days' => 30,
        'absolute_max_age_days' => 365,
        'max_items_per_type' => 10,
    ],
    'cleanup' => [
        'run_probability' => 0.01,
        'minimum_interval_minutes' => 60,
    ],
    'security' => [
        'cookie_name' => 'vw_recorder_owner',
            'cookie_path' => $basePath,
        'hmac_secret' => $credential('VW_RECORDER_HMAC_SECRET', 'hmac_secret', 'change-this-recorder-demo-secret'),
    ],
    'admin' => [
        'username' => $credential('VW_RECORDER_ADMIN_USER', 'admin_username', 'admin'),
        'password' => $credential('VW_RECORDER_ADMIN_PASSWORD', 'admin_password', 'admin'),
    ],
];
