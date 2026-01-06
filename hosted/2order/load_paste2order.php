<?php
$filename = basename($_GET['filename'] ?? '');
if ($filename === '') {
    http_response_code(400);
    echo 'Geen bestandsnaam opgegeven.';
    exit;
}

$dir = __DIR__ . '/data';
$filePath = $dir . '/' . $filename;

if (!is_file($filePath)) {
    http_response_code(404);
    echo 'Bestand niet gevonden.';
    exit;
}

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

readfile($filePath);

