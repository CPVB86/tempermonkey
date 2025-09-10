(function(){
  // ====== namespace
  var B2 = {};
  window.B2 = B2; // expose

  // ====== state (incl. fileBatches voor FBU)
  var state = B2.state = { files:[], rowsA1:[], rowsNorm:[], fileBatches:[] };

  // ====== utils
  function $(sel){ return document.querySelector(sel); }

  // Robuuste parser voor NL/EN getallen -> Number
  function parsePriceNL(v){
    if(v==null || v==='') return 0;
    if(typeof v==='number' && isFinite(v)) return v;
    var s = String(v).replace(/\u00A0/g,' ').trim();
    if(s.length>=2 && ((s[0]==='"' && s[s.length-1]==='"')||(s[0]==="'" && s[s.length-1]==="'"))){ s = s.slice(1,-1); }
    if(/^-?\d{1,3}(?:\.\d{3})+\,\d+$/.test(s)) return Number(s.replace(/\./g,'').replace(',', '.')) || 0; // 1.234,56
    if(/^-?\d+,\d+$/.test(s))                 return Number(s.replace(',', '.')) || 0;                    // 1234,56
    if(/^-?\d+\.\d+$/.test(s))                return Number(s) || 0;                                     // 1234.56
    if(/^-?\d+$/.test(s))                     return Number(s) || 0;                                     // 1234
    var lastComma = s.lastIndexOf(',');
    if(lastComma>=0){ s = s.slice(0,lastComma).replace(/\./g,'') + '.' + s.slice(lastComma+1).replace(/[^\d]/g,''); }
    s = s.replace(/\s+/g,'');
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }
  function numNL(x){ var n = Number(x)||0; return n.toFixed(2).replace('.', ','); }

  // Zorg dat eenheidsprijs-tekst altijd komma gebruikt (geen min; Combine zet min bij retour)
  function toUnitRawNL(unitRaw, unitNum){
    var s = String(unitRaw||'').trim();
    if(!s) return numNL(unitNum);
    var hasComma = s.indexOf(',')>=0, hasDot = s.indexOf('.')>=0;
    if(!hasComma && hasDot && /^-?\d+(\.\d+)?$/.test(s)) s = s.replace('.', ',');
    if(!hasComma && !hasDot && /^\d+$/.test(s) && typeof unitNum==='number') return numNL(unitNum);
    return s.charAt(0)==='-' ? s.slice(1) : s;
  }

  // ====== read (XLSX preferred, CSV ok) via SheetJS
  function readAnyFileToRows(file){
    var name = (file.name||'').toLowerCase();
    var isCSV = name.endsWith('.csv');
    var readPromise = isCSV ? file.text() : file.arrayBuffer();

    return Promise.resolve(readPromise).then(function(bufOrText){
      var wb = XLSX.read(bufOrText, isCSV ? {type:'string'} : {type:'array'});
      var ws = wb.Sheets[wb.SheetNames[0]];
      var arr = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });

      // Verwachte kolommen:
      // 0: Productnaam, 1: ID, 2: SKU(EAN), 3: Size, 4: Aantal verkocht, 5: Prijs/stuk excl., 6: Prijs totaal excl.
      var dataA1 = [];
      for(var i=1;i<arr.length;i++){
        var r = arr[i]||[];
        var first = String(r[0]||'').trim();
        if(!first) continue;
        if(first[0]==='#') continue;
        var low = first.toLowerCase();
        if(low.indexOf('totaal omzet')===0) continue;
        if(low.indexOf('debiteuren')===0) continue;
        if(low.indexOf('crediteuren')===0) continue;

        var qty = r[4], unit = r[5];
        if(qty==='' && unit==='') continue;

        dataA1.push(r);
      }
      return { dataA1:dataA1 };
    });
  }

  // ====== normalize
  function normalize(){
    var out = [], rows = state.rowsA1||[];
    for(var i=0;i<rows.length;i++){
      var r = rows[i];
      var product = String(r[0]||'').trim();
      var sku     = String(r[2]||'').trim(); // EAN = SKU
      var qtyRaw  = r[4];                    // number of string
      var unitRaw = r[5];

      var qty    = parsePriceNL(qtyRaw);     // mag negatief
      var unitEx = parsePriceNL(unitRaw);
      if(!qty || !unitEx) continue;

      var isReturn = (qty < 0) || (unitEx < 0);
      var qtyAbs   = Math.abs(qty);
      var unitAbs  = Math.abs(unitEx);

      out.push({
        product: product,
        ean: sku,
        unit: unitAbs,                       // voor berekeningen
        unitRaw: toUnitRawNL(unitRaw, unitAbs), // NL-weergave (komma), zonder min
        qty: qtyAbs,
        isReturn: isReturn
      });
    }
    state.rowsNorm = out;
  }

  // ====== expose rows to combiner (incl. unitRaw)
  B2.getRows = function(){
    normalize();
    return (state.rowsNorm||[]).map(function(t){
      return {
        product:t.product,
        ean:t.ean||'',
        unit:t.unit,
        unitRaw:(t.unitRaw||''),
        qty:t.qty,
        isReturn:!!t.isReturn
      };
    });
  };

  // ====== UI (GEEN lokale preview/fallback, GEEN export)
  function updateUI(){
    var fileList = $('#fileListB2');
    var rowCount = $('#rowCountB2');
    if(B2._batches && B2._batches.render) B2._batches.render(); // pilltjes updaten
    if(fileList){ fileList.style.display = state.fileBatches.length ? '' : 'none'; }
    if(rowCount){
      var cnt=state.rowsA1.length||0;
      rowCount.textContent='Rijen ingelezen: '+cnt;
      rowCount.style.display = cnt ? '' : 'none';
    }
    if (window.Combine && typeof Combine.refresh === 'function') { Combine.refresh(); }
  }

  // ====== files toevoegen via FBU batches
  function onFilesSelected(list){
    var files = Array.prototype.slice.call(list||[]);
    var p = Promise.resolve();
    files.forEach(function(f){
      p = p.then(function(){
        return readAnyFileToRows(f).then(function(dat){
          var rows = (dat.dataA1 && dat.dataA1.length) ? dat.dataA1 : [];
          // via FBU toevoegen (rebuild + render + onChange)
          if(B2._batches && B2._batches.addBatch){
            B2._batches.addBatch(f.name, rows);
          } else {
            // noodgeval: direct push + manual rebuild (zou niet moeten gebeuren)
            state.fileBatches.push({name:f.name, rows:rows});
            // derive files/rowsA1
            state.files = state.fileBatches.map(function(b){ return b.name; });
            state.rowsA1 = [];
            state.fileBatches.forEach(function(b){ if(b.rows && b.rows.length) Array.prototype.push.apply(state.rowsA1, b.rows); });
            updateUI();
          }
        });
      });
    });
    return p;
  }

  function init(){
    var inp = $('#inpB2');
    var dz  = $('#dzB2');

    // --- FBU aansluiten (maakt pilltjes + remove logic)
    B2._batches = FBU.attach({
      state: state,
      listEl: '#fileListB2',
      onChange: function(){ updateUI(); } // na add/remove -> UI + Combine
    });

    if(inp){ inp.addEventListener('change', function(e){ onFilesSelected(e.target.files); }); }

    // Dropzone-util verplicht
    if(!window.DZ || !DZ.setup){ console.error('Dropzone-util ontbreekt of is te laat geladen.'); }
    if(dz){ DZ.setup(dz, inp, onFilesSelected); }

    updateUI();
  }

  B2.init = init;
  window.addEventListener('DOMContentLoaded', init, { once:true });
})();
