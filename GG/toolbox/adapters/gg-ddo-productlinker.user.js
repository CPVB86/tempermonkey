// ==UserScript==
// @name         GG Toolbox | Adapter | DDO Productlinker
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.0.0
// @description  Linkt het vijf-cijferige DDO-productnummer; toegang via GG Toolbox Core.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-ddo-productlinker.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-ddo-productlinker.user.js
// ==/UserScript==
(() => {
  'use strict';
  if (window.__ggDDOProductLinker) return;
  const ADMIN_BASE = 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=';
  const RE = /\b(\d{5})-\d{2,3}-\d{2,3}\b/g;
  const SKIP = 'a,textarea,input,select,button,script,style,noscript,template,[contenteditable]:not([contenteditable="false"]),#gg-toolbox';
  const marker = 'data-gg-ddo-productlink';
  const pageAllowed = () => /^\/(?:products(?:\/|$)|orders\/view\/|picklocations\/view\/|goods\/inbound\/)/.test(window.location.pathname);
  const enabled = () => pageAllowed() && window.__ggToolbox?.isEnabled('ddoProductLinker') === true;
  function linkify(node) {
    if (!enabled() || !node.isConnected || !node.parentElement || node.parentElement.closest(SKIP)) return;
    const text = node.nodeValue || '';
    RE.lastIndex = 0;
    if (!RE.test(text)) return;
    RE.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(RE)) {
      fragment.append(document.createTextNode(text.slice(last, match.index)));
      const link = document.createElement('a');
      link.textContent = match[1];
      link.href = ADMIN_BASE + encodeURIComponent(match[1]);
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.setAttribute(marker, ''); link.style.textDecoration = 'underline';
      fragment.append(link, document.createTextNode(match[0].slice(match[1].length)));
      last = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(last)));
    node.replaceWith(fragment);
  }
  function walk(root) {
    if (!enabled() || !root.isConnected) return;
    if (root.nodeType === 3) { linkify(root); return; }
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(linkify);
  }
  let active = false;
  function sync() {
    const next = enabled();
    if (next === active) return;
    active = next;
    if (active) walk(document.body);
    else document.querySelectorAll('a[' + marker + ']').forEach(link => {
      const parent = link.parentNode;
      link.replaceWith(document.createTextNode(link.textContent));
      parent.normalize();
    });
  }
  function boot() {
    sync();
    new MutationObserver(mutations => {
      sync();
      if (!active) return;
      const roots = new Set();
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') roots.add(mutation.target);
        else for (const node of mutation.addedNodes) roots.add(node);
      }
      roots.forEach(walk);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    // Handle late core loading and route/identity changes without DOM mutations.
    setInterval(sync, 1000);
    document.addEventListener('click', event => {
      if (event.target.closest?.('a[' + marker + ']') && !enabled()) {
        event.preventDefault(); event.stopImmediatePropagation(); sync();
      }
    }, true);
  }
  window.__ggDDOProductLinker = { version: '1.0.0' };
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
