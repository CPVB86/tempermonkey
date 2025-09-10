// Tiny utility to manage per-file batches + removable pills per source
// Usage per source (DDO/B2/B3):
//   1) Ensure your state has: state.fileBatches = []
//   2) const batches = FBU.attach({
//        state: <module>.state,
//        listEl: '#fileList' | '#fileListB2' | '#fileListB3',
//        // Optional custom rebuild: will be called after add/remove to rebuild rowsA1/files
//        rebuild: function(){ /* default provided; you can omit */ },
//        // Optional onChange: e.g. Combine.refresh()
//        onChange: function(state){ if(window.Combine && Combine.refresh) Combine.refresh(); }
//      });
//   3) After reading a file into rows[]: batches.addBatch(file.name, rows)
//   4) The utility renders X buttons and wires removal automatically.
(function(){
  if (window.FBU) return; // idempotent
  var FBU = {};
  window.FBU = FBU;

  function $(sel){ return document.querySelector(sel); }

  FBU.attach = function(cfg){
    if(!cfg || !cfg.state) throw new Error('FBU.attach: cfg.state required');
    var state = cfg.state;
    if(!state.fileBatches) state.fileBatches = [];

    var listEl = typeof cfg.listEl === 'string' ? $(cfg.listEl) : cfg.listEl;

    var rebuild = (typeof cfg.rebuild === 'function') ? cfg.rebuild : function(){
      // Default rebuild: derive state.files + state.rowsA1 from batches
      state.files = state.fileBatches.map(function(b){ return b.name; });
      var all = [];
      for(var i=0;i<state.fileBatches.length;i++){
        var b = state.fileBatches[i];
        if(b && b.rows && b.rows.length) Array.prototype.push.apply(all, b.rows);
      }
      state.rowsA1 = all;
    };

    var onChange = (typeof cfg.onChange === 'function') ? cfg.onChange : function(){};

    function escapeHtml(s){ s=String(s==null?'':s); return s.replace(/[&<>"']/g,function(c){return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':'&#39;';}); }
    function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }

    function render(){
      if(!listEl) return;
      if(!state.fileBatches.length){ listEl.innerHTML=''; return; }
      var out=[];
      for(var i=0;i<state.fileBatches.length;i++){
        var b = state.fileBatches[i] || {};
        out.push(
          '<span class="file-pill">'+
            '<span class="name">'+escapeHtml(b.name || ('Bestand '+(i+1)))+'</span>'+
            '<button type="button" class="file-remove" data-idx="'+i+'" aria-label="Verwijder '+escapeAttr(b.name||('bestand '+(i+1)))+'">×</button>'+
          '</span>'
        );
      }
      listEl.innerHTML = out.join(' ');
    }

    function addBatch(name, rows){
      state.fileBatches.push({ name:name, rows:rows || [] });
      rebuild();
      render();
      onChange(state);
    }

    function removeAt(idx){
      if(idx<0 || idx>=state.fileBatches.length) return;
      state.fileBatches.splice(idx,1);
      rebuild();
      render();
      onChange(state);
    }

    if(listEl && !listEl.__fbuBound){
      listEl.addEventListener('click', function(e){
        var btn = e.target.closest('.file-remove');
        if(!btn) return;
        var idx = parseInt(btn.getAttribute('data-idx'),10);
        if(!isNaN(idx)) removeAt(idx);
      });
      listEl.__fbuBound = true;
    }

    // Public API for the module
    return {
      addBatch: addBatch,
      removeAt: removeAt,
      render: render,
      rebuild: function(){ rebuild(); onChange(state); },
      state: state
    };
  };
})();
