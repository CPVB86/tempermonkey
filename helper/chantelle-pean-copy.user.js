// ==UserScript==
// @name         Chantelle PEAN Copu
// @namespace    https://runiversity.nl/
// @version      1.1.0
// @description  Kopieer uit #peanTable: Maat\tEAN\tReferentie-KleurCode + vink 'Alleen actieve collectie' standaard uit + TU => No Size + band+cup => 70A + Paste ID knop
// @match        https://chantelle-lingerie.my.site.com/DefaultStore/ccrz__CCPage?pageKey=PEANDL*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM_getClipboard
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/chantelle-pean-copy.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/chantelle-pean-copy.user.js
// ==/UserScript==

(() => {
  "use strict";

  const TABLE_SEL = "#peanTable";
  const OUTLET_CHECKBOX_SEL = "#outletCheckbox"; // 'Alleen actieve collectie'
  const REFERENCE_INPUT_SEL = "#referenceInput";

  const safe = (v) => (v == null ? "" : String(v)).trim();

  // Pak alles voor '-' als kleurcode
  const colorToCode = (kleur) => {
    const s = safe(kleur);
    if (!s) return "";
    const i = s.indexOf("-");
    return (i >= 0 ? s.slice(0, i) : s).trim();
  };

  const normalizeSize = (maat) => {
    const m = safe(maat).toUpperCase();
    if (m === "TU") return "No Size";
    return safe(maat);
  };

  // combineer band + cup wanneer beide aanwezig zijn
  const buildMaat = ({ band, cup, maat }) => {
    const b = safe(band);
    const c = safe(cup);
    if (b && c) return `${b}${c}`; // 70 + A => 70A
    return normalizeSize(maat);
  };

  const uncheckOutletCheckbox = () => {
    const cb = document.querySelector(OUTLET_CHECKBOX_SEL);
    if (!cb) return false;

    if (cb.checked) {
      cb.checked = false;
      cb.dispatchEvent(new Event("input", { bubbles: true }));
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  };

  const buildTSVFromTable = () => {
    const table = document.querySelector(TABLE_SEL);
    if (!table) {
      return {
        tsv: "",
        count: 0,
        error: `Tabel niet gevonden (${TABLE_SEL}). Zoek eerst en zorg dat je op de juiste pagina zit.`,
      };
    }

    const rows = [...table.querySelectorAll("tbody tr.myAccOrderRows")];
    if (!rows.length) {
      return { tsv: "", count: 0, error: "Geen resultaten gevonden. Doe eerst een zoekactie (bv. softstretch)." };
    }

    const lines = new Set();

    for (const tr of rows) {
      const tds = tr.querySelectorAll("td.cc_table_col");

      // Verwachte kolommen:
      // 0 lijn, 1 referentie, 2 kleur, 3 cup, 4 maat (of bandmaat), 5 ean
      const referentie = safe(tds[1]?.innerText);

      const kleurRaw = safe(tds[2]?.innerText) || safe(tds[3]?.innerText);
      const cup = safe(tds[3]?.innerText);
      const bandOrMaat = safe(tds[4]?.innerText);
      const ean = safe(tds[5]?.querySelector("span")?.innerText || tds[5]?.innerText);

      if (!referentie || !bandOrMaat || !ean) continue;

      const kleurCode = colorToCode(kleurRaw);
      if (!kleurCode) continue;

      const maat = buildMaat({ band: bandOrMaat, cup, maat: bandOrMaat });
      const refKl = `${referentie}-${kleurCode}`;

      // OUTPUT: maat \t EAN \t ref-kl
      lines.add(`${maat}\t${ean}\t${refKl}`);
    }

    const tsv = [...lines].sort((a, b) => a.localeCompare(b, "nl")).join("\n");
    return { tsv, count: lines.size, error: "" };
  };

  const copyText = async (text) => {
    if (!text) return false;

    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text);
      return true;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  };

  const readClipboard = async () => {
    if (typeof GM_getClipboard === "function") {
      try {
        const value = GM_getClipboard();
        if (value != null) return String(value);
      } catch (_) {}
    }

    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }

    throw new Error("Clipboard lezen niet ondersteund in deze omgeving.");
  };

  const setReferenceInput = (value) => {
    const input = document.querySelector(REFERENCE_INPUT_SEL);
    if (!input) return { ok: false, error: `Input niet gevonden (${REFERENCE_INPUT_SEL}).` };

    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();

    return { ok: true };
  };

  const makeButtons = () => {
    if (document.getElementById("peanCopyBtn") || document.getElementById("peanPasteBtn")) return;

    const baseStyle = `
      position: fixed;
      left: 600px;
      z-index: 999999;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(0,0,0,.15);
      background: #111;
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 10px 30px rgba(0,0,0,.25);
    `;

    const pasteBtn = document.createElement("button");
    pasteBtn.id = "peanPasteBtn";
    pasteBtn.type = "button";
    pasteBtn.textContent = "Paste ID";
    pasteBtn.style.cssText = `
      ${baseStyle}
      top: 310px;
    `;

    pasteBtn.addEventListener("click", async () => {
      try {
        const text = safe(await readClipboard());

        if (!text) {
          const old = pasteBtn.textContent;
          pasteBtn.textContent = "Clipboard leeg";
          setTimeout(() => (pasteBtn.textContent = old), 1400);
          return;
        }

        const result = setReferenceInput(text);
        if (!result.ok) {
          const old = pasteBtn.textContent;
          pasteBtn.textContent = result.error;
          setTimeout(() => (pasteBtn.textContent = old), 1800);
          return;
        }

        const old = pasteBtn.textContent;
        pasteBtn.textContent = "ID geplakt";
        setTimeout(() => (pasteBtn.textContent = old), 1400);
      } catch (err) {
        const old = pasteBtn.textContent;
        pasteBtn.textContent = "Plakken mislukt";
        console.error("Paste ID fout:", err);
        setTimeout(() => (pasteBtn.textContent = old), 1800);
      }
    });

    const copyBtn = document.createElement("button");
    copyBtn.id = "peanCopyBtn";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy EAN";
    copyBtn.style.cssText = `
      ${baseStyle}
      top: 360px;
    `;

    copyBtn.addEventListener("click", async () => {
      const { tsv, count, error } = buildTSVFromTable();

      if (error) {
        const old = copyBtn.textContent;
        copyBtn.textContent = error;
        setTimeout(() => (copyBtn.textContent = old), 1800);
        return;
      }

      if (!tsv.trim()) {
        const old = copyBtn.textContent;
        copyBtn.textContent = "Geen regels";
        setTimeout(() => (copyBtn.textContent = old), 1400);
        return;
      }

      await copyText(tsv);

      const old = copyBtn.textContent;
      copyBtn.textContent = `Gekopieerd: ${count} regels`;
      setTimeout(() => (copyBtn.textContent = old), 1400);
    });

    document.body.appendChild(pasteBtn);
    document.body.appendChild(copyBtn);
  };

  const init = () => {
    uncheckOutletCheckbox();
    makeButtons();
  };

  init();
  setTimeout(uncheckOutletCheckbox, 600);
  setTimeout(uncheckOutletCheckbox, 1500);

  // Houd 'm uitgevinkt als de pagina re-rendert
  const obs = new MutationObserver(() => {
    uncheckOutletCheckbox();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
