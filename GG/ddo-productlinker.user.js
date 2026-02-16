// ==UserScript==
// @name         GG | DDO productlinker
// @namespace    https://dutchdesignersoutlet.com/
// @version      1.0.1
// @description  Maakt van "38001-82-445" alleen "38001" een admin-link (nieuw tab) op Goedgepickt orders/products pagina's.
// @match        https://fm-e-warehousing.goedgepickt.nl/orders/view/*
// @match        https://fm-e-warehousing.goedgepickt.nl/products*
// @match        https://fm-e-warehousing.goedgepickt.nl/picklocations/view/*
// @match        https://fm-e-warehousing.goedgepickt.nl/products/incoming*
// @match        https://fm-e-warehousing.goedgepickt.nl/products/outgoing-products*
// @match        https://fm-e-warehousing.goedgepickt.nl/goods/inbound/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/ddo-productlinker.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/ddo-productlinker.user.js
// ==/UserScript==

(() => {
  "use strict";

  const ADMIN_BASE =
    "https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=";

  // Strict: 5 digits - (2 or 3 digits) - (2 or 3 digits)
  // Voorbeeld: 38001-82-445
  const RE = /\b(\d{5})-\d{2,3}-\d{2,3}\b/g;

  const shouldSkipNode = (node) => {
    const el = node.parentElement;
    if (!el) return false;
    return Boolean(
      el.closest("a, textarea, input, select, button, [contenteditable='true']")
    );
  };

  const linkifyTextNode = (textNode) => {
    if (!textNode || !textNode.nodeValue) return;

    const text = textNode.nodeValue;
    RE.lastIndex = 0;
    if (!RE.test(text)) return;

    RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m;

    while ((m = RE.exec(text)) !== null) {
      const fullMatch = m[0];        // bv. "38001-82-445"
      const productId = m[1];        // "38001"
      const start = m.index;
      const end = start + fullMatch.length;

      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));

      // Link alleen het 5-digit ID
      const a = document.createElement("a");
      a.textContent = productId;
      a.href = ADMIN_BASE + encodeURIComponent(productId);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.textDecoration = "underline";
      a.style.cursor = "pointer";

      frag.appendChild(a);
      frag.appendChild(document.createTextNode(fullMatch.slice(productId.length))); // "-82-445" plain text

      last = end;
    }

    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));

    textNode.parentNode.replaceChild(frag, textNode);
  };

  const walkAndLinkify = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.includes("-")) return NodeFilter.FILTER_REJECT;
        if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(linkifyTextNode);
  };

  // Init
  walkAndLinkify(document.body);

  // Voor dynamische content / SPA updates
  const mo = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const n of mut.addedNodes) {
        if (n.nodeType === 3) {
          if (!shouldSkipNode(n)) linkifyTextNode(n);
        } else if (n.nodeType === 1) {
          walkAndLinkify(n);
        }
      }
    }
  });

  mo.observe(document.body, { childList: true, subtree: true });
})();
