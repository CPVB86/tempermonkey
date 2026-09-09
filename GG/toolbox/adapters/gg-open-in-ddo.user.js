// ==UserScript==
// @name         GG Toolbox | Adapter | Open in DDO
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.0.0
// @description  DDO-, MSP- en factuurlinks voor DDO-orders, met toegang via GG Toolbox Core.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-open-in-ddo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-open-in-ddo.user.js
// ==/UserScript==
(() => {
  'use strict';
  if (window.__ggOpenInDDO) return;
  const WRAP = 'gg-open-in-ddo-links';
  const allowed = () => window.__ggToolbox?.isEnabled('openInDDO') === true;
  function context() {
    if (!allowed() || !/^\/orders\/view\//.test(location.pathname)) return null;
    if (document.querySelector('.webshopName')?.textContent.trim() !== 'Dutch Designers Outlet') return null;
    const orderId = [...document.querySelectorAll('.page_title span')].map(span => span.textContent.match(/Bestelling\s+(\d+)/i)?.[1]).find(Boolean);
    return orderId || null;
  }
  function links(orderId) {
    const id = encodeURIComponent(orderId);
    return [
      { label:'Open in DDO', title:'Open deze order in DDO', color:'#7b3cff', attr:'data-ddo-pill', url:'https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=view&id=' + id },
      { label:'Open in MSP', title:'Zoek deze order in MultiSafepay', color:'#00abee', attr:'data-msp-pill', url:'https://merchant.multisafepay.com/allpayments?options.query=' + id },
      { label:'Download Invoice', title:'Open de factuur van deze order in DDO', color:'#000000', attr:'data-ddo-invoice-pill', url:'https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=print&id=' + id },
    ];
  }
  function sync() {
    const orderId = context(), existing = document.getElementById(WRAP);
    if (!orderId) { existing?.remove(); return; }
    const badge = [...document.querySelectorAll('.badge.label')].find(el => el.textContent.includes('Aangemaakt via API'));
    const parent = badge?.parentNode || document.querySelector('.orderdetailscol .m-portlet__body');
    if (!parent) { existing?.remove(); return; }
    if (existing?.dataset.orderId === orderId && existing.parentNode === parent) return;
    existing?.remove();
    const wrap = document.createElement('span'); wrap.id = WRAP; wrap.dataset.orderId = orderId;
    for (const config of links(orderId)) {
      const link = document.createElement('a');
      link.textContent = config.label; link.href = config.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.title = config.title; link.setAttribute('aria-label', config.title);
      link.setAttribute(config.attr, 'true');
      link.className = badge?.className || 'badge label mt-2';
      if (badge?.getAttribute('style')) link.setAttribute('style', badge.getAttribute('style'));
      Object.assign(link.style, { marginLeft:'4px', textDecoration:'none', cursor:'pointer', border:'none', boxSizing:'border-box', verticalAlign:'middle', background:config.color, color:'#ffffff', fontWeight:'400' });
      link.addEventListener('click', event => {
        if (context() !== orderId) { event.preventDefault(); event.stopImmediatePropagation(); sync(); }
      });
      wrap.append(link);
    }
    if (badge) parent.insertBefore(wrap, badge.nextSibling);
    else parent.append(wrap);
  }
  function boot() {
    sync();
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true; queueMicrotask(() => { scheduled = false; sync(); });
    }).observe(document.body, { childList:true, subtree:true, characterData:true });
    setInterval(sync, 1000);
  }
  window.__ggOpenInDDO = { version:'1.0.0' };
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once:true });
})();
