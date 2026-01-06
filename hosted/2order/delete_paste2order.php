<?php
// delete_paste2order.php

$input = json_decode(file_get_contents('php://input'), true);
$filename = basename($input['filename'] ?? '');

if ($filename === '') {
    http_response_code(400);
    echo 'Geen bestandsnaam ontvangen.';
    exit;
}

$dir = __DIR__ . '/data';
$filePath = $dir . '/' . $filename;

if (!is_file($filePath)) {
    http_response_code(404);
    echo 'Bestand bestaat niet (meer).';
    exit;
}

if (!unlink($filePath)) {
    http_response_code(500);
    echo 'Verwijderen mislukt.';
    exit;
}

echo 'Bestand verwijderd: ' . htmlspecialchars($filename, ENT_QUOTES, 'UTF-8');
