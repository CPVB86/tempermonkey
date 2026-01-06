<?php
// Zorg dat de map data/ bestaat en schrijfbaar is.
$input = json_decode(file_get_contents('php://input'), true);
$filename = basename($input['filename'] ?? '');
$content  = $input['content'] ?? '';

if ($filename === '' || $content === '') {
    http_response_code(400);
    echo 'Geen geldige filename/content.';
    exit;
}

$dir = __DIR__ . '/data';
if (!is_dir($dir)) {
    mkdir($dir, 0775, true);
}

$filePath = $dir . '/' . $filename;
if (file_put_contents($filePath, $content) === false) {
    http_response_code(500);
    echo 'Schrijven mislukt.';
    exit;
}

echo 'Bestand opgeslagen als ' . htmlspecialchars($filename, ENT_QUOTES, 'UTF-8');
