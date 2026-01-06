<?php
$dir = __DIR__ . '/data';
if (!is_dir($dir)) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    echo json_encode([]);
    exit;
}

// Case-insensitive .csv (pakt ook .CSV, .Csv etc.)
$files = glob($dir . '/*.[cC][sS][vV]');
$names = array_map('basename', $files);

// Geen caching van deze response
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

echo json_encode($names);
