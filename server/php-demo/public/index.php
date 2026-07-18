<?php
declare(strict_types=1);

require __DIR__ . '/../src/App.php';

use VideoWhisper\RecorderDemo\App;

$app = new App(require __DIR__ . '/../config/config.php');
$app->handle();
