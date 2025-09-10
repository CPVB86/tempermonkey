(function(){
  // ====== namespace
  var B3 = {};
  window.B3 = B3;

  // ====== state
  var state = B3.state = {
    files: [],                 // wordt door FBU afgeleid
    fileBatches: [],           // <<< FBU gebruikt dit
    rowsA1: [],
    rowsNorm: [],
    filterBrand: 'Dream Avenue'
  };

  // ====== utils
  function $(sel){ return document.querySelector(sel); }
  function numNL(x){ var n = Number(x)||0; return n.toFixed(2).replace('.', ','); }
  function toUnitRawNL(unitRaw, unitNum){
    var s = String(unitRaw||'').trim();
    if (!s) return numNL(unitNum);
    var hasComma = s.indexOf(',') >= 0, hasDot = s.indexOf('.') >= 0;
    if (!hasComma && hasDot && /^-?\d+(\.\d+)?$/.test(s)) s = s.replace('.', ',');
    return s;
  }
  function parsePriceNL(v){
    if(v==null || v==='') return 0;
    if(typeof v==='number' && isFinite(v)) return v;
    var s = String(v).replace(/\u00A0/g,' ').trim();
    if(s.length>=2 && ((s[0]==='"' && s[s.length-1]==='"')||(s[0]==="'" && s[s.length-1]==="'"))) s = s.slice(1,-1);
    if(/^-?\d{1,3}(?:\.\d{3})+\,\d+$/.test(s)) return Number(s.replace(/\./g,'').replace(',', '.')) || 0;
    if(/^-?\d+,\d+$/.test(s))                 return Number(s.replace(',', '.')) || 0;
    if(/^-?\d+\.\d+$/.test(s))                return Number(s) || 0;
    if(/^-?\d+$/.test(s))                     return Number(s) || 0;
    var lastComma = s.lastIndexOf(',');
    if(lastComma>=0) s = s.slice(0,lastComma).replace(/\./g,'') + '.' + s.slice(lastComma+1).replace(/[^\d]/g,'');
    s = s.replace(/\s+/g,'');
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }
  function normLabel(s){ return String(s||'').trim().toLowerCase().replace(/\s+/g,' '); }

  // Labels (verkoop/retour – omgedraaid volgens jouw correctie)
  var SOLD_LABEL = normLabel('Verkoopprijs artikel(en), ontvangen van kopers en door bol.com door te storten');
  var RET_LABEL  = normLabel('Correctie verkoopprijs artikel(en)');

  // Merken
  var ALLOWED_BRANDS = ['Dream Avenue','Royal Lounge','Lingadore','Guy de France','Naturana','Bomain'];
  function productMatchesSelectedBrand(product){
    var brand = state.filterBrand || '';
    if(!brand) return true;
    return String(product||'').toLowerCase().indexOf(brand.toLowerCase()) >= 0;
  }

  // ====== read via SheetJS
  function readAnyFileToRows(file){
    var name = (file.name||'').toLowerCase();
    var read = (name.endsWith('.csv') ? file.text() : file.arrayBuffer());
    return Promise.resolve(read).then(function(bufOrText){
      var wb = XLSX.read(bufOrText, name.endsWith('.csv') ? {type:'string'} : {type:'array'});
      var ws = wb.Sheets[wb.SheetNames[0]];
      var arr = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });

      var dataA1 = [];
      for(var i=0;i<arr.length;i++){
        var r = arr[i]||[];
        var lbl = normLabel(r[0]);
        var isSold   = (lbl === SOLD_LABEL);
        var isReturn = (lbl === RET_LABEL);
        if(!isSold && !isReturn) continue;

        var product = String(r[3]||'').trim(); // D
        var ean     = String(r[2]||'').trim(); // C
        var qtyStr  = String(r[6]||'').trim(); // G
        var unitStr = String(r[8]||'').trim(); // I
        if(!product && !ean && !qtyStr && !unitStr) continue;

        dataA1.push(r);
      }
      return { dataA1:dataA1 };
    });
  }

  // ====== normalize -> rowsNorm
  // Mapping: A=label, C=EAN, D=Product, G=Aantal, I=Prijs/stuk
  function normalize(){
    var out = [], rows = state.rowsA1||[];
    for(var i=0;i<rows.length;i++){
      var r = rows[i]||[];
      var lbl = normLabel(r[0]);
      var isSold   = (lbl === SOLD_LABEL);
      var isReturn = (lbl === RET_LABEL);
      if(!isSold && !isReturn) continue;

      var product = String(r[3]||'').trim();
      if(!productMatchesSelectedBrand(product)) continue;

      var ean     = String(r[2]||'').trim();
      var qtyRaw  = String(r[6]||'').trim();
      var unitRaw = String(r[8]||'').trim();

      var qty  = parsePriceNL(qtyRaw);
      var unit = parsePriceNL(unitRaw);
      if(!qty || !unit) continue;

      out.push({
        product: product,
        ean: ean,
        unit: Math.abs(unit),                 // voor berekeningen
        unitRaw: toUnitRawNL(unitRaw, unit),  // NL weergave (komma), zónder minteken
        qty: Math.abs(qty),
        isReturn: !!isReturn
      });
    }
    state.rowsNorm = out;
  }

  // ====== expose rows to Combine
  B3.getRows = function(){
    normalize();
    return (state.rowsNorm||[]).map(function(t){
      return {
        product: t.product,
        ean: t.ean || '',
        unit: t.unit,
        unitRaw: (t.unitRaw || ''),
        qty: t.qty,
        isReturn: !!t.isReturn
      };
    });
  };

  // ====== file selection -> gebruikt FBU batches
  function onFilesSelected(list){
    var files = Array.prototype.slice.call(list||[]);
    var p = Promise.resolve();
    files.forEach(function(f){
      p = p.then(function(){
        return readAnyFileToRows(f).then(function(dat){
          var rows = dat.dataA1 || [];
          if(!rows.length) return;
          // Laat FBU de batch vastleggen en pills tekenen
          if (B3._batches && B3._batches.addBatch){
            B3._batches.addBatch(f.name, rows);
          } else {
            // (failsafe) zonder FBU: append rechtstreeks
            state.rowsA1 = state.rowsA1.concat(rows);
            state.files.push(f.name);
          }
        });
      });
    });
    p.then(function(){ updateUI(); });
  }

  // ====== UI (zoals bron 1: toon/ verberg lijst-div op basis van fileBatches)
  function updateUI(){
    var fileList = $('#fileListB3');
    var rowCount = $('#rowCountB3');

    if (B3._batches && B3._batches.render) B3._batches.render();
    if (fileList){ fileList.style.display = (state.fileBatches && state.fileBatches.length) ? '' : 'none'; }
    if (rowCount){
      var cnt = state.rowsA1.length||0;
      rowCount.textContent = 'Rijen ingelezen: ' + cnt;
      rowCount.style.display = cnt ? '' : 'none';
    }
    if (window.Combine && typeof Combine.refresh === 'function') { Combine.refresh(); }
  }

  // Merkselect
  function bindBrandFilter(){
    var sel = $('#b3BrandFilter');
    if(!sel) return;
    if(!sel.options || sel.options.length===0){
      ALLOWED_BRANDS.forEach(function(name){
        var opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        sel.appendChild(opt);
      });
    }
    if(!sel.value){ sel.value = state.filterBrand; }
    sel.addEventListener('change', function(){
      state.filterBrand = sel.value || 'Dream Avenue';
      updateUI();
    });
  }

  function init(){
    // Vereist DZ + Combine + FBU
    if(!window.DZ || !DZ.setup)  console.error('Dropzone-util ontbreekt of is te laat geladen.');
    if(!window.Combine)          console.error('Combine ontbreekt: deze bron rendert niets zonder Combine.js');
    if(!window.FBU || !FBU.attach) console.error('FileBatch-util ontbreekt: geen X-knoppen in bestandslijst.');

    var inp = $('#inpB3');
    var dz  = $('#dzB3');

    if(inp){ inp.addEventListener('change', function(e){ onFilesSelected(e.target.files); }); }
    if(dz){ DZ.setup(dz, inp, onFilesSelected); }

    // Koppel B3 aan FileBatch-util (zoals bron 1)
    if (window.FBU && FBU.attach){
      B3._batches = FBU.attach({
        state: state,
        listEl: '#fileListB3',
        // onChange: alleen Combine + counters; FBU rendert zelf de pills
        onChange: function(){ 
          var fileList = $('#fileListB3');
          if (fileList) fileList.style.display = (state.fileBatches && state.fileBatches.length) ? '' : 'none';
          if (window.Combine && Combine.refresh) Combine.refresh();
          var rowCount = $('#rowCountB3');
          if (rowCount){
            var cnt = state.rowsA1.length||0;
            rowCount.textContent = 'Rijen ingelezen: ' + cnt;
            rowCount.style.display = cnt ? '' : 'none';
          }
        }
      });
    }

    bindBrandFilter();
    updateUI();
  }

  B3.init = init;
  window.addEventListener('DOMContentLoaded', init, { once:true });
})();
