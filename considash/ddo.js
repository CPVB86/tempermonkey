(function(){
  // ====== namespace
  var DDO = {};
  window.DDO = DDO; // expose for reuse (bron 2/3) & debugging

  // ====== state (incl. fileBatches for FBU)
  var state = DDO.state = { files:[], rowsA1:[], rowsNorm:[], fileBatches:[] };

  // ====== utils
  function $(sel){ return document.querySelector(sel); }
  function asNumber(v){
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && isFinite(v)) return v; // respect numeric cells
    // Replace NBSP without using \u escapes (canvas editor was picky)
    var s = String(v).replace(new RegExp(String.fromCharCode(160), 'g'), ' ').trim();
    var hasComma = s.indexOf(',') >= 0;
    // When comma present: dots are thousands → strip; otherwise keep decimal dot
    var s2 = hasComma ? s.replace(new RegExp('\\.', 'g'), '').replace(',', '.') : s.replace(new RegExp('\\s+', 'g'), '');
    var n = Number(s2);
    return isFinite(n) ? n : 0;
  }
  function joinParts(arr){
    var out = [], i, p;
    for(i=0;i<arr.length;i++){ p = String(arr[i]||'').trim(); if(p) out.push(p); }
    return out.join(' ');
  }

  // ====== file reading (xlsx/csv)
  function readAnyFileToRows(file){
    var name = (file.name||'').toLowerCase();
    if (name.slice(-4) === '.csv'){
      return file.text().then(function(text){
        var wb = XLSX.read(text, { type:'string' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var arr = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
        var dataA1 = arr.slice(1).filter(function(r){ return (r||[]).some(function(v){ return String(v).trim()!==''; }); });
        return { dataA1:dataA1 };
      });
    } else {
      return file.arrayBuffer().then(function(buf){
        var wb = XLSX.read(buf, { type:'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var arr = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
        var dataA1 = arr.slice(1).filter(function(r){ return (r||[]).some(function(v){ return String(v).trim()!==''; }); });
        return { dataA1:dataA1 };
      });
    }
  }

  // ====== add files via FBU batches
  function onFilesSelected(list){
    var files = Array.prototype.slice.call(list||[]);
    var p = Promise.resolve();
    files.forEach(function(f){
      p = p.then(function(){
        return readAnyFileToRows(f).then(function(dat){
          var rows = (dat.dataA1 && dat.dataA1.length) ? dat.dataA1 : [];
          if (DDO._batches && DDO._batches.addBatch){
            DDO._batches.addBatch(f.name, rows);
          } else {
            // emergency (shouldn’t happen if FBU is loaded)
            state.fileBatches.push({name:f.name, rows:rows});
            state.files = state.fileBatches.map(function(b){ return b.name; });
            state.rowsA1 = [];
            state.fileBatches.forEach(function(b){
              if (b.rows && b.rows.length) Array.prototype.push.apply(state.rowsA1, b.rows);
            });
            updateUI();
          }
        });
      });
    });
    return p;
  }

  // ====== DDO normalize + summarize
  function normalizeDDO(){
    var out = [], rows = state.rowsA1||[];
    for (var i=0;i<rows.length;i++){
      var r = rows[i];
      var ean = String(r[1]||'').trim();
      var product = joinParts([r[2],r[3],r[4],r[5]]) + '-' + String(r[6]||'').trim();
      var unitInc = asNumber(r[10]); // prijs incl. 21%
      var sold    = asNumber(r[8]);
      var ret     = asNumber(r[9]);
      if (unitInc <= 0) continue;

      if (sold > 0){
        out.push({ product:product, ean:ean, unitInc:unitInc, qty:sold, isReturn:false });
      }
      if (ret > 0){
        out.push({ product:product, ean:ean, unitInc:unitInc, qty:ret, isReturn:true });
      }
    }
    state.rowsNorm = out;
  }

  function summarizeDDO(){
    var map = Object.create(null), list = state.rowsNorm||[];
    for (var i=0;i<list.length;i++){
      var t = list[i];
      var key = t.product + '||' + (t.ean||'') + '||' + t.unitInc.toFixed(2);
      if (!map[key]) map[key] = { product:t.product, ean:(t.ean||''), unitInc:t.unitInc, soldQty:0, soldTotal:0, retQty:0, retTotal:0 };
      var a = map[key];
      if (t.isReturn || t.qty < 0){ var q1 = Math.abs(t.qty); a.retQty += q1; a.retTotal += t.unitInc*q1; }
      else { var q2 = t.qty; a.soldQty += q2; a.soldTotal += t.unitInc*q2; }
    }
    var arr=[], keys=Object.keys(map);
    for (var k=0;k<keys.length;k++) arr.push(map[keys[k]]);
    arr.sort(function(x,y){ var p=x.product.localeCompare(y.product); if(p!==0) return p; return (x.ean||'').localeCompare(y.ean||''); });
    return arr;
  }

  // ====== expose normalized rows for combiner
  DDO.getRows = function(){
    normalizeDDO();
    return (state.rowsNorm||[]).map(function(t){
      return { product:t.product, ean:t.ean||'', unitInc:t.unitInc, qty:t.qty, isReturn:!!t.isReturn };
    });
  };

  // ====== UI (always through Combine; no local preview or export)
  function updateUI(){
    var fileList = $('#fileList');
    var rowCount = $('#rowCount');
    if (DDO._batches && DDO._batches.render) DDO._batches.render();
    if (fileList){ fileList.style.display = state.fileBatches.length ? '' : 'none'; }
    if (rowCount){ var cnt = state.rowsA1.length||0; rowCount.textContent = 'Rijen ingelezen: ' + cnt; rowCount.style.display = cnt ? '' : 'none'; }
    if (window.Combine && typeof Combine.refresh === 'function') { Combine.refresh(); }
  }

  function init(){
    // Requires Dropzone-util (DZ) & FileBatch-util (FBU). Combine renders the preview.
    if(!window.DZ || !DZ.setup){ console.error('Dropzone-util ontbreekt of is te laat geladen.'); }
    if(!window.FBU || !FBU.attach){ console.error('FileBatch-util ontbreekt of is te laat geladen.'); }

    var inp = $('#inpDDO');
    var dz  = $('#dzDDO');

    // FBU batches (pills + remove “×”)
    if (window.FBU && FBU.attach){
      DDO._batches = FBU.attach({
        state: state,
        listEl: '#fileList',
        onChange: function(){ updateUI(); }
      });
    }

    if (inp){ inp.addEventListener('change', function(e){ onFilesSelected(e.target.files); }); }
    if (dz && window.DZ){ DZ.setup(dz, inp, onFilesSelected); }

    updateUI();
  }
  DDO.init = init;

  // auto-init
  window.addEventListener('DOMContentLoaded', init, { once:true });
})();
