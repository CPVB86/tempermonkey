// Export "exactly what you see" from the #preview DOM into a CSV.
// No fallbacks, no separate calculations. Triggered by #btnExport.
(function(){
  if (window.Export) return; // idempotent
  var Export = {};
  window.Export = Export;

  var DELIM = ';';

  function $(sel){ return document.querySelector(sel); }

  function escCSV(s){
    s = String(s == null ? '' : s);
    var must = (s.indexOf(DELIM) >= 0) || (s.indexOf('\n') >= 0) || (s.indexOf('\r') >= 0) || (s.indexOf('"') >= 0);
    if (s.indexOf('"') >= 0) s = s.replace(/"/g, '""');
    return must ? ('"' + s + '"') : s;
  }

  function cellTexts(cells){
    var out = [];
    for (var i=0;i<cells.length;i++){
      var t = cells[i].textContent.trim();
      out.push(escCSV(t));
    }
    return out;
  }

  // Expand a <tfoot> row like: [ "Subtotaal", <lastValue> ] to a fixed width row
  // with blanks between, based on colCount (from thead or first body row).
  function expandFooterRow(tr, colCount){
    var tds = tr.querySelectorAll('th,td');
    if (!tds.length) return [];
    var first = (tds[0].textContent || '').trim();
    var last  = (tds[tds.length-1].textContent || '').trim();
    var row = new Array(colCount);
    for (var i=0;i<colCount;i++) row[i] = '';
    row[0] = escCSV(first);
    row[colCount-1] = escCSV(last);
    return row;
  }

  // Convert one table (with optional thead/tbody/tfoot) into CSV lines.
  // If a wrapper contains a .mini label (e.g. "Verkocht", "Retour", "Totaal"),
  // we emit that label as a single line before the table.
  function tableToCsvLines(wrapperDiv){
    var lines = [];
    var labelEl = wrapperDiv.querySelector('.mini');
    if (labelEl) lines.push(escCSV(labelEl.textContent.trim()));

    var table = wrapperDiv.querySelector('table');
    if (!table) return lines;

    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    var tfoot = table.querySelector('tfoot');

    var colCount = 0;

    // Header
    if (thead){
      var ths = thead.querySelectorAll('tr th');
      if (ths.length){
        colCount = ths.length;
        lines.push(cellTexts(ths).join(DELIM));
      }
    }

    // If we still don't know colCount, peek first body row
    if (!colCount && tbody){
      var firstRow = tbody.querySelector('tr');
      if (firstRow){
        colCount = firstRow.querySelectorAll('td,th').length;
      }
    }

    // Body rows
    if (tbody){
      var trs = tbody.querySelectorAll('tr');
      for (var i=0;i<trs.length;i++){
        var tds = trs[i].querySelectorAll('td,th');
        lines.push(cellTexts(tds).join(DELIM));
      }
    }

    // Footer (e.g. Subtotaal)
    if (tfoot){
      var ftrs = tfoot.querySelectorAll('tr');
      for (var j=0;j<ftrs.length;j++){
        var expanded = expandFooterRow(ftrs[j], colCount || 2);
        if (expanded.length) lines.push(expanded.join(DELIM));
      }
    }

    return lines;
  }

  // Build CSV from the entire preview region.
  // We walk the children in order to preserve "Bron X" / "Totaal" grouping.
  function buildCsvFromPreview(){
    var root = $('#preview');
    if (!root) return '';

    var lines = [];
    var kids = Array.from(root.children);

    for (var i=0;i<kids.length;i++){
      var el = kids[i];

      // Section headers like: <div><strong>Bron 1</strong></div>
      var strong = el.querySelector && el.querySelector('strong');
      if (strong){
        lines.push(escCSV(strong.textContent.trim()));
        continue;
      }

      // Wrappers that contain a .mini + <table> (Verkocht/Retour/Totaal)
      var tbl = el.querySelector && el.querySelector('table');
      if (tbl){
        var tableLines = tableToCsvLines(el);
        for (var k=0;k<tableLines.length;k++){
          lines.push(tableLines[k]);
        }
        continue;
      }
    }

    return lines.join('\r\n');
  }

  function downloadCsv(csvText){
    if (!csvText) return;
    var blob = new Blob(["\ufeff"+csvText], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ConsiDash_Export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function bind(){
    var btn = $('#btnExport');
    if (!btn) return;

    // Remove any previous listeners cleanly
    var clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);

    clone.addEventListener('click', function(){
      var csv = buildCsvFromPreview();
      if (!csv){
        // geen preview/rijen → geen export
        return;
      }
      downloadCsv(csv);
    });
  }

  function init(){ bind(); }
  window.addEventListener('DOMContentLoaded', init, { once:true });
})();
