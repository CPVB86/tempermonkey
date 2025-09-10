(function(){
  // ====== namespace
  var DDO = {};
  window.DDO = DDO; // expose for reuse (bron 2/3) & debugging

  // ====== state
  var state = DDO.state = { files:[], rowsA1:[], rowsNorm:[] };

  // ====== utils
  function $(sel){ return document.querySelector(sel); }
  function asNumber(v){
    if(v==null || v==='') return 0;
    if(typeof v === 'number' && isFinite(v)) return v; // respecteer numerieke cellen
    var s = String(v).replace(/\u00A0/g,' ').trim(); // NBSP safe
    var hasComma = s.indexOf(',') >= 0;
    // Als er een komma staat, zijn punten duizendtallen → strippen; anders laat decimale punt staan
    var s2 = hasComma ? s.replace(/\./g,'').replace(',', '.') : s.replace(/\s+/g,'');
    var n = Number(s2);
    return isFinite(n) ? n : 0;
  }
  function joinParts(arr){
    var out = [], i, p;
    for(i=0;i<arr.length;i++){ p=String(arr[i]||'').trim(); if(p) out.push(p); }
    return out.join(' ');
  }

  // ====== file reading (xlsx/csv)
  function readAnyFileToRows(file){
    var name = (file.name||'').toLowerCase();
    if(name.slice(-4)==='.csv'){
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

  function onFilesSelected(list){
    var files = Array.prototype.slice.call(list||[]);
    var p = Promise.resolve();
    files.forEach(function(f){
      p = p.then(function(){
        return readAnyFileToRows(f).then(function(dat){
          state.files.push(f.name);
          if(dat.dataA1 && dat.dataA1.length){ Array.prototype.push.apply(state.rowsA1, dat.dataA1); }
        });
      });
    });
    p.then(function(){ updateUI(); });
  }

  // ====== DDO normalize + summarize
  function normalizeDDO(){
    var out = [], rows = state.rowsA1||[];
    for (var i=0;i<rows.length;i++){
      var r = rows[i];
      var ean = String(r[1]||'').trim();
      var product = joinParts([r[2],r[3],r[4],r[5]]) + '-' + String(r[6]||'').trim();
      var unitInc = asNumber(r[10]); // prijs incl. 21%
      var sold = asNumber(r[8]);
      var ret  = asNumber(r[9]);
      if (unitInc<=0) continue;

      if (sold>0){
        out.push({ product:product, ean:ean, unitInc:unitInc, qty:sold, isReturn:false });
      }
      if (ret>0){
        out.push({ product:product, ean:ean, unitInc:unitInc, qty:ret, isReturn:true });
      }
    }
    state.rowsNorm = out;
  }

  function summarizeDDO(){
    var map = Object.create(null);
    var list = state.rowsNorm||[];
    for(var i=0;i<list.length;i++){
      var t = list[i];
      var key = t.product + '||' + (t.ean||'') + '||' + t.unitInc.toFixed(2);
      if (!map[key]) map[key] = { product:t.product, ean:(t.ean||''), unitInc:t.unitInc, soldQty:0, soldTotal:0, retQty:0, retTotal:0 };
      var a = map[key];
      if(t.isReturn || t.qty<0){ var q1=Math.abs(t.qty); a.retQty+=q1; a.retTotal+= t.unitInc*q1; }
      else{ var q2=t.qty; a.soldQty+=q2; a.soldTotal+= t.unitInc*q2; }
    }
    var arr=[], keys=Object.keys(map);
    for(var k=0;k<keys.length;k++){ arr.push(map[keys[k]]); }
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

  // ====== UI (altijd via Combine; géén fallback preview)
  function updateUI(){
    var fileList = $('#fileList');
    var rowCount = $('#rowCount');
    if(fileList){ fileList.textContent = state.files.join(', '); fileList.style.display = state.files.length ? '' : 'none'; }
    if(rowCount){ var cnt = state.rowsA1.length||0; rowCount.textContent = 'Rijen ingelezen: ' + cnt; rowCount.style.display = cnt ? '' : 'none'; }
    if (window.Combine && typeof Combine.refresh === 'function') { Combine.refresh(); }
  }

  function init(){
    // Vereist Dropzone-util en Combine
    if(!window.DZ || !DZ.setup){ console.error('Dropzone-util ontbreekt of is te laat geladen.'); }
    if(!window.Combine){ console.error('Combine ontbreekt: deze bron rendert niets zonder Combine.js'); }

    var inp = $('#inpDDO');
    var dz  = $('#dzDDO');

    if(inp){ inp.addEventListener('change', function(e){ onFilesSelected(e.target.files); }); }
    if(dz){ DZ.setup(dz, inp, onFilesSelected); }

    updateUI();
  }
  DDO.init = init;

  // auto-init
  window.addEventListener('DOMContentLoaded', init, { once:true });
})();
