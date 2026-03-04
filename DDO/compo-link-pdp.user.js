// ==UserScript==
// @name         DDO | Composition Link PDP
// @namespace    https://runiversity.nl/
// @version      1.0.0
// @description  Toon een link-icoon achter het composition veld dat naar de URL in het veld verwijst.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        none
// @author       C. P. van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/compo-link-pdp.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/compo-link-pdp.user.js
// ==/UserScript==

(function () {
  'use strict';

  function isLikelyUrl(str) {
    if (!str) return false;
    const s = String(str).trim();
    return /^https?:\/\/\S+/i.test(s);
  }

  function createLinkEl() {
    const a = document.createElement('a');
    a.setAttribute('data-comp-link', '1');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Open composition URL';
    a.textContent = '🔗';
    a.style.marginLeft = '6px';
    a.style.textDecoration = 'none';
    a.style.fontSize = '14px';
    a.style.verticalAlign = 'middle';
    a.style.cursor = 'pointer';
    return a;
  }

  function updateLink(a, url) {
    const ok = isLikelyUrl(url);
    if (ok) {
      a.href = url.trim();
      a.style.opacity = '1';
      a.style.pointerEvents = 'auto';
      a.title = `Open: ${url.trim()}`;
    } else {
      a.removeAttribute('href');
      a.style.opacity = '0.35';
      a.style.pointerEvents = 'none';
      a.title = 'Geen geldige URL in composition';
    }
  }

  function init() {
    const input = document.querySelector('input[name="composition"].control, input[name="composition"]');
    if (!input) return;

    // voorkom dubbele injectie
    if (input.nextElementSibling && input.nextElementSibling.getAttribute('data-comp-link') === '1') return;

    const link = createLinkEl();
    input.insertAdjacentElement('afterend', link);

    // initieel updaten
    updateLink(link, input.value);

    // live updaten bij wijzigen
    input.addEventListener('input', () => updateLink(link, input.value));
    input.addEventListener('change', () => updateLink(link, input.value));
  }

  // Sommige admin-pagina's laden delen dynamisch; daarom: probeer meteen + observeer kort.
  init();

  const obs = new MutationObserver(() => init());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // optioneel: na 10s observer uit (kan je weghalen als je wil)
  setTimeout(() => obs.disconnect(), 10000);
})();
