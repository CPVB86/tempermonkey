// ==UserScript==
// @name         meyB2B - NewTab
// @namespace    https://runiversity.nl/
// @version      1.2.0
// @description  Adds a stable button on collection tiles to open the item in a new tab (survives re-renders).
// @match        https://www.meyb2b.com/*
// @match        https://meyb2b.com/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const TILE_SELECTOR = 'li.CollectionItemView.features-stylecollection-StyleCollectionItemView';
  const BTN_CLASS = "tm-open-newtab-btn";
  const BTN_ATTR = "data-tm-openbtn";

  function buildDetailUrlFromTile(li) {
    const rel = li.getAttribute("rel") || "";
    const parts = rel.split(";").map(s => s.trim()).filter(Boolean);

    // rel voorbeeld: "ME;NO;1320000;*;1320000-1725;1725"
    const countryPrefix = parts.slice(0, 4).join(";"); // "ME;NO;1320000;*"
    const color = parts[5] || parts[4]?.split("-")?.[1] || ""; // "1725"

    if (!countryPrefix || !color) return null;

    const encoded = encodeURIComponent(countryPrefix); // "ME%3BNO%3B1320000%3B*"
    const currentHash = window.location.hash || "";

    // vervang tail "/ME%3B...%3B*/1725"
    const newHash = currentHash.replace(
      /\/ME%3B[^/]+\/\d+$/i,
      `/${encoded}/${encodeURIComponent(color)}`
    );

    if (newHash === currentHash) {
      const idx = currentHash.lastIndexOf("/ME%3B");
      const base = idx > -1 ? currentHash.slice(0, idx) : currentHash;
      return `${location.origin}${location.pathname}${base}/${encoded}/${encodeURIComponent(color)}`;
    }

    return `${location.origin}${location.pathname}${newHash}`;
  }

  function injectStyles() {
    if (document.getElementById("tm-open-newtab-styles")) return;
    const style = document.createElement("style");
    style.id = "tm-open-newtab-styles";
    style.textContent = `
      ${TILE_SELECTOR} { position: relative !important; overflow: visible !important; }
      ${TILE_SELECTOR} .box { overflow: visible !important; }

      .${BTN_CLASS}{
        position:absolute;
        top:40px;
        right:8px;
        z-index:99999;
        width:28px;
        height:28px;
        border-radius:10px;
        border:1px solid rgba(0,0,0,.25);
        background: rgba(255,255,255,.92);
        cursor:pointer;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:14px;
        line-height:1;
        user-select:none;
        box-shadow: 0 2px 8px rgba(0,0,0,.12);
        pointer-events: auto;
      }
      .${BTN_CLASS}:hover{ transform: translateY(-1px); }
      .${BTN_CLASS}:active{ transform: translateY(0px); }
    `;
    document.head.appendChild(style);
  }

  function ensureButton(li) {
    // Als framework re-rendered kan onze node verdwijnen.
    // Daarom: check op data-attr, anders opnieuw injecteren.
    if (li.querySelector(`.${BTN_CLASS}[${BTN_ATTR}="1"]`)) return;

    const btn = document.createElement("div");
    btn.className = BTN_CLASS;
    btn.setAttribute(BTN_ATTR, "1");
    btn.title = "Openen in nieuw tabblad";
    btn.textContent = "↗";

    // Niet de tile click triggeren
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    };

    btn.addEventListener("pointerdown", stop, true);
    btn.addEventListener("click", (e) => {
      stop(e);
      const url = buildDetailUrlFromTile(li);
      if (!url) return console.warn("[meyB2B] Geen URL gebouwd voor tile:", li);
      window.open(url, "_blank", "noopener,noreferrer");
    }, true);

    li.appendChild(btn);
  }

  function scan() {
    document.querySelectorAll(TILE_SELECTOR).forEach(ensureButton);
  }

  function observe() {
    const mo = new MutationObserver(() => {
      // licht throttlen via microtask/raf om spam te vermijden
      requestAnimationFrame(scan);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    injectStyles();
    scan();
    observe();

    // Extra “self-heal” voor agressieve re-renders:
    // elke 400ms checken en ontbrekende knopjes terugzetten.
    setInterval(scan, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
