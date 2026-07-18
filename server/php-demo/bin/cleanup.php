#!/usr/bin/env php
<?php
declare(strict_types=1);

require __DIR__ . '/../src/App.php';

use VideoWhisper\RecorderDemo\App;

$app = new App(require __DIR__ . '/../config/config.php');
$summary = $app->cleanup();
echo json_encode($summary, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
