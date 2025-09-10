(function(){
  // ====== namespace
  var B3 = {};
  window.B3 = B3;

  // ====== state
  var state = B3.state = {
    files: [],
    rowsA1: [],
    rowsNorm: [],
    filterBrand: 'Dream Avenue' // standaard keuze
  };

  // ====== utils
  // === utils (voeg toe in B3)
function numNL(x){ var n = Number(x)||0; return n.toFixed(2).replace('.', ','); }

// Converteer unitRaw naar NL-weergave:
// - als er al een komma in zit: laat staan
// - als alleen punt-decimaal: vervang '.' -> ','
// - anders fallback: format uit het numerieke 'unit' (parse)
function toUnitRawNL(unitRaw, unitNum){
  var s = String(unitRaw||'').trim();
  if (!s) return numNL(unitNum);
  var hasComma = s.indexOf(',') >= 0;
  var hasDot   = s.indexOf('.') >= 0;
  // Alleen punt-decimaal (géén duizendtallen) → simpele vervanging
  if (!hasComma && hasDot && /^-?\d+(\.\d+)?$/.test(s)){
    s = s.replace('.', ',');
  }
  return s;
}

  function $(sel){ return document.querySelector(sel); }

  // NL prijs/hoeveelheid -> Number (voor berekeningen); bronstring apart bewaren
  function parsePriceNL(v){
    if(v==null || v==='') return 0;
    if(typeof v==='number' && isFinite(v)) return v;
    var s = String(v).replace(/\u00A0/g,' ').trim(); // NBSP weg
    // strip quotes
    if(s.length>=2 && ((s[0]==='"' && s[s.length-1]==='"')||(s[0]==="'" && s[s.length-1]==="'"))){
      s = s.slice(1,-1);
    }
    if(/^-?\d{1,3}(?:\.\d{3})+\,\d+$/.test(s)) return Number(s.replace(/\./g,'').replace(',', '.')) || 0; // 1.234,56
    if(/^-?\d+,\d+$/.test(s))                 return Number(s.replace(',', '.')) || 0;                    // 1234,56
    if(/^-?\d+\.\d+$/.test(s))                return Number(s) || 0;                                     // 1234.56
    if(/^-?\d+$/.test(s))                     return Number(s) || 0;                                     // 1234
    var lastComma = s.lastIndexOf(',');
    if(lastComma>=0){
      s = s.slice(0,lastComma).replace(/\./g,'') + '.' + s.slice(lastComma+1).replace(/[^\d]/g,'');
    }
    s = s.replace(/\s+/g,'');
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }

  function normLabel(s){
    return String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  }

  // >>> JUISTE MAPPING (omgedraaid t.o.v. eerder):
  // Verkocht = "Verkoopprijs artikel(en), ontvangen van kopers en door bol.com door te storten"
  // Retour   = "Correctie verkoopprijs artikel(en)"
  var SOLD_LABEL = normLabel('Verkoopprijs artikel(en), ontvangen van kopers en door bol.com door te storten');
  var RET_LABEL  = normLabel('Correctie verkoopprijs artikel(en)');

  // Toegestane merken (voor de select)
  var ALLOWED_BRANDS = [
    'Dream Avenue',
    'Royal Lounge',
    'Lingadore',
    'Guy de France',
    'Naturana',
    'Bomain'
  ];

  function productMatchesSelectedBrand(product){
    var brand = state.filterBrand || '';
    if(!brand) return true; // safety
    return String(product||'').toLowerCase().indexOf(brand.toLowerCase()) >= 0;
  }

  // ====== read any (xlsx/csv) via SheetJS
  function readAnyFileToRows(file){
    var name = (file.name||'').toLowerCase();
    var read = (name.endsWith('.csv') ? file.text() : file.arrayBuffer());

    return Promise.resolve(read).then(function(bufOrText){
      var wb = XLSX.read(bufOrText, name.endsWith('.csv') ? {type:'string'} : {type:'array'});
      var ws = wb.Sheets[wb.SheetNames[0]];
      var arr = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });

      // Filter: alleen rijen met het label in kolom A
      var dataA1 = [];
      for(var i=0;i<arr.length;i++){
        var r = arr[i]||[];
        var lbl = normLabel(r[0]);
        var isSold   = (lbl === SOLD_LABEL);
        var isReturn = (lbl === RET_LABEL);
        if(!isSold && !isReturn) continue;

        // Minimale velden aanwezig?
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

  function onFilesSelected(list){
    var files = Array.prototype.slice.call(list||[]);
    var p = Promise.resolve();
    files.forEach(function(f){
      p = p.then(function(){
        return readAnyFileToRows(f).then(function(dat){
          state.files.push(f.name);
          if(dat.dataA1 && dat.dataA1.length){
            Array.prototype.push.apply(state.rowsA1, dat.dataA1);
          }
        });
      });
    });
    p.then(function(){ updateUI(); });
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
      if(!productMatchesSelectedBrand(product)) continue; // <-- merkfilter

      var ean     = String(r[2]||'').trim();
      var qtyRaw  = String(r[6]||'').trim();
      var unitRaw = String(r[8]||'').trim();

      var qty  = parsePriceNL(qtyRaw);
      var unit = parsePriceNL(unitRaw);
      if(!qty || !unit) continue;

      out.push({
        product: product,
        ean: ean,
        unit: Math.abs(unit),     // voor berekeningen
        unitRaw: toUnitRawNL(unitRaw, unit), // NL-weergave (met komma) zonder min
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

  // ====== UI (geen fallback, geen export)
  function updateUI(){
    var fileList = $('#fileListB3');
    var rowCount = $('#rowCountB3');
    if(fileList){ fileList.textContent = state.files.join(', '); fileList.style.display = state.files.length?'':'none'; }
    if(rowCount){ var cnt=state.rowsA1.length||0; rowCount.textContent='Rijen ingelezen: '+cnt; rowCount.style.display = cnt?'':'none'; }
    if (window.Combine && typeof Combine.refresh === 'function') { Combine.refresh(); }
  }

  // Koppel selectbox; vul opties als ze nog ontbreken
  function bindBrandFilter(){
    var sel = $('#b3BrandFilter');
    if(!sel) return;

    // als er (nog) geen opties zijn, vul ze
    if(!sel.options || sel.options.length===0){
      ALLOWED_BRANDS.forEach(function(name){
        var opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        sel.appendChild(opt);
      });
    }

    // standaard selectie
    if(!sel.value){ sel.value = state.filterBrand; }

    sel.addEventListener('change', function(){
      state.filterBrand = sel.value || 'Dream Avenue';
      updateUI(); // herberekenen + Combine.refresh()
    });
  }

  function init(){
    // Vereist DZ + Combine
    if(!window.DZ || !DZ.setup){ console.error('Dropzone-util ontbreekt of is te laat geladen.'); }
    if(!window.Combine){ console.error('Combine ontbreekt: deze bron rendert niets zonder Combine.js'); }

    var inp = $('#inpB3');
    var dz  = $('#dzB3');

    if(inp){ inp.addEventListener('change', function(e){ onFilesSelected(e.target.files); }); }
    if(dz){ DZ.setup(dz, inp, onFilesSelected); }

    bindBrandFilter();
    updateUI();
  }

  B3.init = init;
  window.addEventListener('DOMContentLoaded', init, { once:true });
})();
