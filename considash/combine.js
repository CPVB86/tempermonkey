(function(){
  // ====== Combine: één tabel, geen export ======
  var Combine = {};
  window.Combine = Combine;

  // helpers
  function ensureMinus(txt){
    txt = String(txt == null ? '' : txt).trim();
    if (!txt) return txt;
    return txt.charAt(0) === '-' ? txt : ('-' + txt);
  }
  function $(sel){ return document.querySelector(sel); }
  function asNumber(v){
    if(v==null||v==='') return 0;
    if(typeof v==='number'&&isFinite(v)) return v;
    var s=String(v).replace(/\u00A0/g,' ').trim();
    var hasComma=s.indexOf(',')>=0;
    var s2=hasComma ? s.replace(/\./g,'').replace(',', '.') : s.replace(/\s+/g,'');
    var n=Number(s2);
    return isFinite(n)?n:0;
  }
  function numNL(x){ var n=Number(x)||0; return n.toFixed(2).replace('.', ','); }
  function html(s){
    s=(s==null?'':String(s));
    return s.replace(/[&<>"']/g,function(c){
      return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':'&#39;';
    });
  }

  // Verzamel genormaliseerde rijen uit bronnen
  function collectRows(){
    var rows=[];
    if (window.DDO && typeof DDO.getRows==='function'){
      try {
        DDO.getRows().forEach(function(t){
          rows.push({
            product:t.product,
            ean:t.ean||'',
            unit:asNumber(t.unitInc||t.unit),
            unitRaw:(t.unitRaw||''),
            qty:asNumber(t.qty),
            isReturn:!!t.isReturn,
            src:'DDO'
          });
        });
      } catch(_){}
    }
    if (window.B2 && typeof B2.getRows==='function'){
      try {
        B2.getRows().forEach(function(t){
          rows.push({
            product:t.product,
            ean:t.ean||'',
            unit:asNumber(t.unit||t.unitInc),
            unitRaw:(t.unitRaw||''),
            qty:asNumber(t.qty),
            isReturn:!!t.isReturn,
            src:'B2'
          });
        });
      } catch(_){}
    }
   
   if (window.B3 && typeof B3.getRows==='function'){
  try {
    B3.getRows().forEach(function(t){
      rows.push({
        product: t.product,
        ean: t.ean || '',
        unit: asNumber(t.unit || t.unitInc),
        unitRaw: (t.unitRaw || ''),
        qty: asNumber(t.qty),
        isReturn: !!t.isReturn,
        src: 'B3'
      });
    });
  } catch(_){}
}

    return rows;
  }

  function renderCombined(){
    var el = $('#preview'); if(!el) return;

    var all = collectRows();
    if(!all.length){ el.innerHTML=''; return; }

    // Per bron aggregeren op product+ean+unit (binnen bron)
    var bySrc=Object.create(null), totals={soldSum:0, retSum:0};
    for(var i=0;i<all.length;i++){
      var t=all[i]; var src=t.src||'Overig';
      if(!bySrc[src]) bySrc[src]={ map:Object.create(null) };
      var key=t.product+'||'+(t.ean||'')+'||'+(t.unit.toFixed? t.unit.toFixed(2):Number(t.unit).toFixed(2));
      var b=bySrc[src];
      if(!b.map[key]) b.map[key]={ product:t.product, ean:(t.ean||''), unit:asNumber(t.unit), unitRaw:(t.unitRaw||''), soldQty:0, soldTotal:0, retQty:0, retTotal:0 };
      var a=b.map[key]; if(!a.unitRaw && t.unitRaw) a.unitRaw=t.unitRaw;
      if(t.isReturn){ a.retQty+=t.qty; a.retTotal+=t.unit*t.qty; totals.retSum+=t.unit*t.qty; }
      else { a.soldQty+=t.qty; a.soldTotal+=t.unit*t.qty; totals.soldSum+=t.unit*t.qty; }
    }

    var parts=[]; var order=['DDO','B2','B3']; var labels={ DDO:'Bron: DDO', B2:'Bron: F&M E-Warehousing', B3:'Bron: BOL' };

    for(var oi=0; oi<order.length; oi++){
      var src=order[oi]; if(!bySrc[src]) continue;
      var arr=[]; var map=bySrc[src].map; Object.keys(map).forEach(function(k){ arr.push(map[k]); });
      arr.sort(function(x,y){ var p=x.product.localeCompare(y.product); if(p!==0) return p; return (x.ean||'').localeCompare(y.ean||''); });

      var sold=[], ret=[], soldSum=0, retSum=0;
      for(var k=0;k<arr.length;k++){
        var r=arr[k];
        if(r.soldQty>0){ soldSum+=r.soldTotal; sold.push(r); }
        if(r.retQty>0){  retSum+=r.retTotal;  ret.push(r);  }
      }

      parts.push('<div style="margin:10px 0 6px"><strong>'+labels[src]+'</strong></div>');

      // Verkocht
      parts.push('<div style="margin:6px 0"><div class="mini" style="margin:0 0 4px">Verkocht</div>');
      parts.push('<table><thead><tr><th>Product</th><th>EAN</th><th class="num">prijs per eenheid</th><th class="num">aantal verkocht</th><th class="num">totaal bedrag</th></tr></thead><tbody>');
      for(var s=0;s<sold.length;s++){
        var v=sold[s];
        parts.push(
          '<tr><td>'+html(v.product)+'</td><td>'+html(v.ean||'')+'</td>'+
          '<td class="num">'+(v.unitRaw?html(v.unitRaw):numNL(v.unit))+'</td>'+
          '<td class="num">'+v.soldQty+'</td>'+
          '<td class="num">'+numNL(v.soldTotal)+'</td></tr>'
        );
      }
      parts.push('</tbody><tfoot><tr><td colspan="4">Subtotaal</td><td class="num">'+numNL(soldSum)+'</td></tr></tfoot></table></div>');

      // Retour
      parts.push('<div style="margin:12px 0 0"><div class="mini" style="margin:0 0 4px">Retour</div>');
      parts.push('<table><thead><tr><th>Product</th><th>EAN</th><th class="num">prijs per eenheid</th><th class="num">aantal retour</th><th class="num">totaal bedrag</th></tr></thead><tbody>');
      for(var u=0;u<ret.length;u++){
        var w=ret[u];
        parts.push(
          '<tr><td>'+html(w.product)+'</td><td>'+html(w.ean||'')+'</td>'+
          '<td class="num">'+(w.unitRaw ? html(ensureMinus(w.unitRaw)) : ('-'+numNL(w.unit)))+'</td>'+
          '<td class="num">'+w.retQty+'</td>'+
          '<td class="num">'+numNL(-w.retTotal)+'</td></tr>'
        );
      }
      parts.push('</tbody><tfoot><tr><td colspan="4">Subtotaal</td><td class="num">-'+numNL(retSum)+'</td></tr></tfoot></table></div>');
    }

    // Totaal over alle bronnen
    parts.push('<div style="margin-top:10px"><div class="mini" style="margin:0 0 4px">Totaal</div>');
    parts.push('<table><tbody>');
    parts.push('<tr><td>Omzet verkocht</td><td class="num">'+numNL(totals.soldSum)+'</td></tr>');
    parts.push('<tr><td>Omzet retour</td><td class="num">-'+numNL(totals.retSum)+'</td></tr>');
    parts.push('<tr><td>Netto omzet over alle bronnen</td><td class="num">'+numNL(totals.soldSum - totals.retSum)+'</td></tr>');
    parts.push('</tbody></table></div>');

    el.innerHTML = parts.join('');
  }

  // Publieke API
  Combine.refresh = function(){ renderCombined(); };

  // Init
  function init(){ Combine.refresh(); }
  window.addEventListener('DOMContentLoaded', init, {once:true});
})();
