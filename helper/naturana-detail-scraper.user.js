// ==UserScript==
// @name         Helper | Naturana Detail Scraper
// @namespace    https://runiversity.nl/
// @version      1.1.0
// @description  Kopieert alleen de tekst-content uit de product-info accordion naar je klembord, maar slaat alles vanaf "Manufacturer Information" over. Button + hotkey Ctrl+Shift+V.
// @match        https://naturana.com/*
// @grant        GM_setClipboard
// @run-at       document-end
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/naturana-detail-scraper.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/naturana-detail-scraper.user.js
// ==/UserScript==

(function () {
  "use strict";

  const HOTKEY = { ctrl: true, shift: true, key: "v" };
  const BTN_ID = "ddo-copy-product-content-btn";

  function norm(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findAccordionGroup() {
    return (
      document.querySelector('.product-info__block-group.accordion-group[data-group-type="accordion-group"]') ||
      document.querySelector(".product-info__block-group.accordion-group") ||
      document.querySelector('[data-group-type="accordion-group"]')
    );
  }

  function getTitle(blockItem) {
    const span = blockItem.querySelector("summary span");
    return span ? span.textContent.trim() : "";
  }

  function getContentText(blockItem) {
    // Pak alleen de zichtbare content (meestal in .accordion__content)
    const content = blockItem.querySelector(".accordion__content");
    if (!content) return "";

    // bullets + paragrafen netjes meenemen
    const lines = [];

    // Als er <li>’s zijn, zet ze als bullets
    const lis = Array.from(content.querySelectorAll("li"));
    if (lis.length) {
      for (const li of lis) {
        const t = li.textContent.replace(/\s+/g, " ").trim();
        if (t) lines.push(`- ${t}`);
      }
    }

    // Pak ook paragrafen/losse tekst (maar voorkom dubbele li-tekst)
    const ps = Array.from(content.querySelectorAll("p"));
    for (const p of ps) {
      // haal <br> netjes naar newlines
      const cloned = p.cloneNode(true);
      cloned.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      const t = cloned.textContent
        .split("\n")
        .map((x) => x.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
      if (t) lines.push(t);
    }

    // Fallback: als er geen li/p is, pak gewoon textContent
    if (!lines.length) {
      const t = content.textContent.replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
    }

    // Dedup simpele duplicates
    return Array.from(new Set(lines)).join("\n");
  }

  function buildCleanText() {
    const group = findAccordionGroup();
    if (!group) throw new Error("Geen accordion group gevonden (.product-info__block-group.accordion-group).");

    const items = Array.from(group.querySelectorAll(".product-info__block-item"));
    if (!items.length) throw new Error("Geen .product-info__block-item gevonden.");

    const stopAt = "manufacturer information";
    const chunks = [];

    for (const item of items) {
      const title = getTitle(item);
      if (norm(title) === stopAt) break;

      const body = getContentText(item);
      // Alleen toevoegen als er echt content is
      if (body) {
        // Zet een kopje erboven (optioneel, maar meestal handig)
        chunks.push(`${title}\n${body}`.trim());
      }
    }

    return chunks.join("\n\n").trim();
  }

  async function copyToClipboard(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  function toast(msg, ok = true) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 999999;
      padding: 10px 12px; border-radius: 10px;
      font: 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      color: #fff; background: ${ok ? "#16a34a" : "#dc2626"};
      box-shadow: 0 10px 20px rgba(0,0,0,.25);
      max-width: 320px;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  async function doCopy() {
    try {
      const text = buildCleanText();
      if (!text) throw new Error("Geen content gevonden om te kopiëren.");
      await copyToClipboard(text);
      toast('Gekopieerd (zonder HTML) — tot vóór "Manufacturer Information".', true);
    } catch (e) {
      toast(`Kon niet kopiëren: ${e.message || e}`, false);
      console.error(e);
    }
  }

  function addButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "Copy Content (Ctrl+Shift+V)";
    btn.style.cssText = `
      position: fixed; right: 16px; top: 16px; z-index: 999999;
      padding: 10px 12px; border-radius: 12px;
      border: 1px solid rgba(0,0,0,.15);
      background: #111827; color: #fff;
      font: 13px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      cursor: pointer;
      box-shadow: 0 10px 20px rgba(0,0,0,.2);
    `;
    btn.addEventListener("click", doCopy);
    document.body.appendChild(btn);
  }

  function addHotkey() {
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.ctrlKey && e.shiftKey && norm(e.key) === HOTKEY.key) {
          const t = e.target;
          const isTyping =
            t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
          if (isTyping) return;

          e.preventDefault();
          doCopy();
        }
      },
      { capture: true }
    );
  }

  addButton();
  addHotkey();
})();
