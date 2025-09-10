<?php
/**
 * Minimal SimpleXLSXGen-compatible XLSX generator (single file)
 *
 * This is a lightweight, dependency-free class that implements the most-used
 * API of the original SimpleXLSXGen library by Sergey Shuchkin:
 *  - \Shuchkin\SimpleXLSXGen::fromArray($rows, $sheetName)
 *  - ->addSheet($rows, $sheetName)
 *  - ->saveAs($filename)
 *  - ->downloadAs($filename)
 *  - (string)$xlsx to get the XLSX bytes
 *
 * It supports text, numbers (dot or comma as decimal separator), empty cells,
 * multiple sheets, basic styles.xml, and proper XLSX packaging. For advanced
 * features (styles, formulas, hyperlinks, merges, etc.) use the official lib.
 *
 * MIT License
 * Copyright (c) 2025
 */

namespace Shuchkin;

class SimpleXLSXGen
{
    /** @var array<int, array{ name:string, rows: array<int, array<int, mixed>> }> */
    protected $sheets = [];

    /** Default document props */
    protected $creator = 'SimpleXLSXGen (minimal)';

    /** Create from a single 2D array */
    public static function fromArray(array $rows, string $name = 'Sheet1') : self
    {
        $x = new self();
        $x->addSheet($rows, $name);
        return $x;
    }

    /** Add a sheet */
    public function addSheet(array $rows, string $name = 'Sheet1') : self
    {
        // Normalize: force sequential rows and cells
        $norm = [];
        foreach ($rows as $r) {
            $row = [];
            if (\is_array($r)) {
                foreach ($r as $v) { $row[] = $v; }
            } else {
                $row[] = $r;
            }
            $norm[] = $row;
        }
        $this->sheets[] = [ 'name' => $this->sanitizeSheetName($name), 'rows' => $norm ];
        return $this;
    }

    /** Save to file */
    public function saveAs(string $filename) : void
    {
        $bin = (string) $this;
        $dir = \dirname($filename);
        if ($dir && !is_dir($dir)) @mkdir($dir, 0775, true);
        $f = @fopen($filename, 'wb');
        if (!$f) throw new \RuntimeException('Cannot write file: ' . $filename);
        fwrite($f, $bin);
        fclose($f);
    }

    /** Send to browser for download */
    public function downloadAs(string $filename = 'export.xlsx') : void
    {
        $bin = (string) $this;
        if (!headers_sent()) {
            header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            header('Content-Disposition: attachment; filename="' . $this->safeFilename($filename) . '"');
            header('Content-Transfer-Encoding: binary');
            header('Cache-Control: must-revalidate');
            header('Pragma: public');
            header('Content-Length: ' . strlen($bin));
        }
        echo $bin;
        exit;
    }

    /** Return XLSX bytes */
    public function __toString() : string
    {
        return $this->buildXlsx();
    }

    // ---------------- internal helpers -----------------

    protected function buildXlsx() : string
    {
        if (empty($this->sheets)) {
            $this->addSheet([[]], 'Sheet1');
        }

        // Create a temporary zip archive in memory
        $tmp = tempnam(sys_get_temp_dir(), 'sxg');
        $zip = new \ZipArchive();
        if ($zip->open($tmp, \ZipArchive::OVERWRITE) !== true) {
            throw new \RuntimeException('Cannot create zip archive');
        }

        // Files
        $zip->addFromString('[Content_Types].xml', $this->contentTypesXml());
        $zip->addFromString('_rels/.rels', $this->relsRootXml());
        $zip->addFromString('docProps/app.xml', $this->docPropsAppXml());
        $zip->addFromString('docProps/core.xml', $this->docPropsCoreXml());
        $zip->addFromString('xl/workbook.xml', $this->workbookXml());
        $zip->addFromString('xl/_rels/workbook.xml.rels', $this->relsWorkbookXml());
        $zip->addFromString('xl/styles.xml', $this->stylesXml());

        // Sheets
        foreach ($this->sheets as $i => $sheet) {
            $zip->addFromString('xl/worksheets/sheet' . ($i+1) . '.xml', $this->worksheetXml($sheet['rows']));
        }

        $zip->close();
        $bin = file_get_contents($tmp);
        @unlink($tmp);
        return $bin !== false ? $bin : '';
    }

    protected function sanitizeSheetName(string $name) : string
    {
        $name = trim($name);
        if ($name === '') $name = 'Sheet' . (count($this->sheets) + 1);
        // Strip invalid chars: : \\ / ? * [ ]
        $name = preg_replace('/[:\\\\\/\?\*\[\]]/', ' ', $name);
        // Max 31 chars
        $name = mb_substr($name, 0, 31);
        return $name;
    }

    protected function safeFilename(string $name) : string
    {
        return preg_replace('/[^A-Za-z0-9_\-. ]+/', '_', $name);
    }

    protected function contentTypesXml() : string
    {
        $sheetOverrides = '';
        for ($i = 1; $i <= count($this->sheets); $i++) {
            $sheetOverrides .= '<Override PartName="/xl/worksheets/sheet' . $i . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }
        return '<?xml version="1.0" encoding="UTF-8"?>'
            . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . $sheetOverrides
            . '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            . '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
            . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            . '</Types>';
    }

    protected function relsRootXml() : string
    {
        return '<?xml version="1.0" encoding="UTF-8"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            . '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
            . '</Relationships>';
    }

    protected function relsWorkbookXml() : string
    {
        $rels = '';
        for ($i = 1; $i <= count($this->sheets); $i++) {
            $rels .= '<Relationship Id="rId' . $i . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $i . '.xml"/>';
        }
        return '<?xml version="1.0" encoding="UTF-8"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . $rels
            . '</Relationships>';
    }

    protected function docPropsAppXml() : string
    {
        $parts = '';
        foreach ($this->sheets as $s) {
            $parts .= '<vt:lpstr>' . $this->xml($s['name']) . '</vt:lpstr>';
        }
        return '<?xml version="1.0" encoding="UTF-8"?>'
            . '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
            . '<Application>SimpleXLSXGen</Application>'
            . '<DocSecurity>0</DocSecurity>'
            . '<ScaleCrop>false</ScaleCrop>'
            . '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>' . count($this->sheets) . '</vt:i4></vt:variant></vt:vector></HeadingPairs>'
            . '<TitlesOfParts><vt:vector size="' . count($this->sheets) . '" baseType="lpstr">' . $parts . '</vt:vector></TitlesOfParts>'
            . '</Properties>';
    }

    protected function docPropsCoreXml() : string
    {
        $now = gmdate('Y-m-d\TH:i:s\Z');
        return '<?xml version="1.0" encoding="UTF-8"?>'
            . '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
            . ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            . '<dc:creator>' . $this->xml($this->creator) . '</dc:creator>'
            . '<cp:lastModifiedBy>' . $this->xml($this->creator) . '</cp:lastModifiedBy>'
            . '<dcterms:created xsi:type="dcterms:W3CDTF">' . $now . '</dcterms:created>'
            . '<dcterms:modified xsi:type="dcterms:W3CDTF">' . $now . '</dcterms:modified>'
            . '</cp:coreProperties>';
    }

    protected function workbookXml() : string
    {
        $sheetsXml = '';
        foreach ($this->sheets as $i => $s) {
            $id = $i + 1;
            $sheetsXml .= '<sheet name="' . $this->xml($s['name']) . '" sheetId="' . $id . '" r:id="rId' . $id . '"/>';
        }
        return '<?xml version="1.0" encoding="UTF-8"?>'
            . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<bookViews><workbookView/></bookViews>'
            . '<sheets>' . $sheetsXml . '</sheets>'
            . '</workbook>';
    }

    protected function stylesXml() : string
    {
        // Minimal styles.xml with General format
        return '<?xml version="1.0" encoding="UTF-8"?>'
            . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<numFmts count="0"/>'
            . '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
            . '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="0"/></cellXfs>'
            . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            . '</styleSheet>';
    }

    protected function worksheetXml(array $rows) : string
    {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<sheetData>';

        foreach ($rows as $rIdx => $row) {
            $xml .= '<row r="' . ($rIdx + 1) . '">';
            foreach ((array)$row as $cIdx => $v) {
                $cellRef = $this->cellRef($rIdx, $cIdx);
                if ($v === null || $v === '') {
                    $xml .= '<c r="' . $cellRef . '"/>';
                    continue;
                }
                // Detect numbers (allow comma or dot)
                if (\is_int($v) || \is_float($v)) {
                    $xml .= '<c r="' . $cellRef . '"><v>' . $this->normalizeNumber($v) . '</v></c>';
                } elseif (\is_string($v) && preg_match('/^\s*-?\d+(?:[\.,]\d+)?\s*$/u', $v)) {
                    $n = str_replace(',', '.', str_replace(' ', '', $v));
                    $xml .= '<c r="' . $cellRef . '"><v>' . $this->normalizeNumber($n) . '</v></c>';
                } else {
                    $xml .= '<c r="' . $cellRef . '" t="inlineStr"><is><t xml:space="preserve">' . $this->xml((string)$v) . '</t></is></c>';
                }
            }
            $xml .= '</row>';
        }

        $xml .= '</sheetData></worksheet>';
        return $xml;
    }

    protected function cellRef(int $rowIndex, int $colIndex) : string
    {
        return $this->colLetter($colIndex) . ($rowIndex + 1);
    }

    protected function colLetter(int $i) : string
    {
        $s = '';
        $i = (int)$i;
        while ($i >= 0) {
            $s = chr(ord('A') + ($i % 26)) . $s;
            $i = (int)($i / 26) - 1;
        }
        return $s;
    }

    protected function xml(string $s) : string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    protected function normalizeNumber($n) : string
    {
        // Ensure dot decimal separator for XLSX XML
        if (\is_string($n)) $n = str_replace(',', '.', $n);
        return rtrim(rtrim(sprintf('%.12F', (float)$n), '0'), '.');
    }
}
