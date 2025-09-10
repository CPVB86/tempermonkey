// ==UserScript==
// @name         GG / Return Clipper Visual
// @author       C. P. v. Beek
// @version      1.4
// @description  Kopieert een screenshot van een return op het klembord.
// @match        https://fm-e-warehousing.goedgepickt.nl/returns/view/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/return-clipper-visual.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/return-clipper-visual.user.js
// ==/UserScript==

(function () {
  'use strict';

  const H2C_URL = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";

  const qs = (s, r = document) => r.querySelector(s);

  function injectScriptOnce(src) {
    return new Promise((resolve) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  function withTemporarilyHidden(els, run) {
    const prev = [];
    els.forEach(el => {
      if (!el) return;
      prev.push([el, el.style.display]);
      el.style.display = "none";
    });
    const res = run();
    const finish = () => prev.forEach(([el, val]) => { el.style.display = val || ""; });
    return (res && res.then) ? res.finally(finish) : (finish(), res);
  }

  async function copyCanvasToClipboard(canvas, filename = "screenshot-page-content.png") {
    if (navigator.clipboard && window.ClipboardItem) {
      const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("📋 Gekopieerd naar klembord!");
        return;
      } catch (e) {
        console.warn("Clipboard write failed, fallback to download.", e);
      }
    }
    const a = document.createElement("a");
    a.download = filename;
    a.href = canvas.toDataURL("image/png");
    a.click();
    toast("⬇️ Kon niet naar klembord; bestand gedownload.");
  }

  function toast(text) {
    const t = document.createElement("div");
    t.textContent = text;
    Object.assign(t.style, {
      position: "fixed", right: "12px", bottom: "12px", zIndex: 999999,
      background: "rgba(0,0,0,0.85)", color: "#fff", padding: "10px 12px",
      borderRadius: "8px", fontSize: "13px"
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function findStatusBlock() {
    const rs = qs(".returnStatus");
    return rs ? rs.closest(".col-lg-12") : null;
  }
  function findHistoryBlock() {
    const head = [...document.querySelectorAll(".m-portlet__head-text")]
      .find(el => el.textContent.trim() === "Retour geschiedenis");
    return head ? head.closest(".col-md-5") : null;
  }
  function findActionsUpdatedBlock() {
    const el = qs(".cancelReturn, .reRunEvents, .updated_at, .created_at");
    return el ? el.closest(".col-md-12") : null;
  }

  async function doCapture() {
    const target = qs(".page-content");
    if (!target) { alert("Geen .page-content gevonden."); return; }

    await injectScriptOnce(H2C_URL);

    const statusBlock = findStatusBlock();
    const historyBlock = findHistoryBlock();
    const actionsUpdatedBlock = findActionsUpdatedBlock();

    const prevOverflow = target.style.overflow;
    target.style.overflow = "visible";

    await withTemporarilyHidden([statusBlock, historyBlock, actionsUpdatedBlock], async () => {
      window.scrollTo(0, 0);
      const canvas = await html2canvas(target, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: null,
        scale: window.devicePixelRatio || 1,
        scrollX: 0,
        scrollY: 0,
        windowWidth: document.documentElement.clientWidth,
        windowHeight: document.documentElement.clientHeight
      });
      await copyCanvasToClipboard(canvas);
    });

    target.style.overflow = prevOverflow || "";
  }

  async function addTopbarButton() {
    const navUl = document.querySelector(".m-stack__item.m-topbar__nav-wrapper ul.m-topbar__nav");
    if (!navUl) return;

    if (qs("#gp-copy-page-content-btn-li", navUl)) return;

    const li = document.createElement("li");
    li.id = "gp-copy-page-content-btn-li";
    li.className = "m-nav__item m-topbar__notifications";

    const a = document.createElement("a");
    a.href = "#";
    a.className = "m-nav__link";
    a.title = "Kopieer .page-content naar klembord";

    const span = document.createElement("span");
    span.className = "m-nav__link-icon";

    const i = document.createElement("i");
    i.className = "fas fa-camera";
    span.appendChild(i);

    a.appendChild(span);
    li.appendChild(a);

    // Voeg LI helemaal links toe
    navUl.insertBefore(li, navUl.firstChild);

    a.addEventListener("click", (e) => {
      e.preventDefault();
      doCapture();
    });

    window.addEventListener("keydown", (e) => {
      if (e.shiftKey && (e.key === "C" || e.key === "c")) {
        doCapture();
      }
    });
  }

  // Init
  const obs = new MutationObserver(() => {
    addTopbarButton();
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
