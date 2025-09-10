// Generic, reusable dropzone utility for multiple sources
// Usage:
//   1) Include this file before your source-specific JS
//   2) DZ.setup(dropZoneEl, fileInputEl, (FileList|Array) => void)
//      - Click + Enter/Space opens the file picker
//      - Drag-over adds .dragover, drop assigns files to input + dispatches 'change'
//      - Falls back to calling onFiles(files) if DataTransfer not supported
//   3) Global guards prevent navigation on drop outside drop-zones
(function(){
  if (window.DZ) return; // idempotent
  var DZ = {};
  window.DZ = DZ;

  // One-time global guards (prevent browser from opening files on page drop)
  if (!document.__dzGuardsInstalled) {
    document.addEventListener('dragover', function(e){ e.preventDefault(); }, {capture:true, passive:false});
    document.addEventListener('drop', function(e){
      var t = e.target;
      if (!(t && t.closest && t.closest('.drop-zone'))) e.preventDefault();
    }, {capture:true, passive:false});
    document.__dzGuardsInstalled = true;
  }

  DZ.setup = function(zoneEl, inputEl, onFiles){
    if(!zoneEl || !inputEl) return function(){};

    // Make zone keyboard & a11y friendly
    if(!zoneEl.hasAttribute('tabindex')) zoneEl.setAttribute('tabindex','0');
    if(!zoneEl.hasAttribute('role')) zoneEl.setAttribute('role','button');

    function openPicker(){
      try{ inputEl.value=''; }catch(_){}
      // Safari/Edge sometimes need async click
      try { inputEl.click(); }
      catch(_) { setTimeout(function(){ try{ inputEl.click(); }catch(__){} }, 0); }
    }

    function onDrop(e){
      e.preventDefault(); e.stopPropagation(); zoneEl.classList.remove('dragover');
      var files = (e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files : null;
      if(files && files.length){
        try {
          var dt = new DataTransfer();
          for (var i=0;i<files.length;i++) dt.items.add(files[i]);
          inputEl.files = dt.files;
          inputEl.dispatchEvent(new Event('change', { bubbles:true }));
        } catch(err){ if(typeof onFiles === 'function') onFiles(files); }
      }
    }

    // Click & keyboard
    var onClick = function(e){ e.preventDefault(); openPicker(); };
    var onKey   = function(e){ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); openPicker(); } };

    // Drag feedback
    var onEnter = function(e){ e.preventDefault(); e.stopPropagation(); zoneEl.classList.add('dragover'); };
    var onOver  = function(e){ e.preventDefault(); e.stopPropagation(); zoneEl.classList.add('dragover'); if(e.dataTransfer) e.dataTransfer.dropEffect='copy'; };
    var onLeave = function(e){ e.preventDefault(); e.stopPropagation(); zoneEl.classList.remove('dragover'); };

    // Bind
    zoneEl.addEventListener('click', onClick);
    zoneEl.addEventListener('keydown', onKey);
    zoneEl.addEventListener('dragenter', onEnter);
    zoneEl.addEventListener('dragover',  onOver);
    zoneEl.addEventListener('dragleave', onLeave);
    zoneEl.addEventListener('drop',      onDrop);

    // Cleanup handle
    return function cleanup(){
      zoneEl.removeEventListener('click', onClick);
      zoneEl.removeEventListener('keydown', onKey);
      zoneEl.removeEventListener('dragenter', onEnter);
      zoneEl.removeEventListener('dragover',  onOver);
      zoneEl.removeEventListener('dragleave', onLeave);
      zoneEl.removeEventListener('drop',      onDrop);
    };
  };
})();
