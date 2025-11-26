// ==UserScript==
// @name         Add Stock | Lisca
// @version      1.3
// @description  Vult voorraad in DDO automatisch op basis van HTML van Lisca
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-lisca.user.js
// ==/UserScript==

(function () {
  "use strict";

  // --- Selectors & consts
  const BTN_ID = "lisca-add-stock-btn";
  const TABLE_SELECTOR = "#tabs-3 table.options";
  const BRAND_TITLE_SELECTOR = "#tabs-1 #select2-brand-container";
  const PID_SELECTOR = '#tabs-1 input[name="supplier_pid"]';

  // --- Helpers
  const isLisca = () => {
    const brand = document.querySelector(BRAND_TITLE_SELECTOR)?.title?.trim() || "";
    return brand.toLowerCase().startsWith("lisca");
  };

  function ensureButton() {
    // Bestaat body?
    if (!document.body) return;

    // Button aanmaken indien nodig
    let btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement("button");
      btn.id = BTN_ID;
      btn.type = "button";
      btn.textContent = "🚛 Add Stock | Lisca";
      btn.style.cssText = `
        position: fixed;
        right: 10px;
        top: 10px;
        z-index: 999999;
        padding: 10px 12px;
        background: #007cba;
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        opacity: 1;
      `;
      document.body.appendChild(btn);
      btn.addEventListener("click", onClick);
    }

    // Activeer/de-activeer knop afhankelijk van merk + tabel-aanwezigheid
    const table = document.querySelector(TABLE_SELECTOR);
    const ok = isLisca() && !!table;
    btn.disabled = !ok;
    btn.style.opacity = ok ? "1" : ".55";
    btn.title = ok
      ? "Plak Lisca HTML van je klembord om voorraad te vullen"
      : (isLisca() ? "Wachten tot #tabs-3 geladen is..." : "Niet Lisca—knop uitgeschakeld");
  }

  function setBtnStatus(text, bg) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (text) btn.textContent = text;
    if (bg) btn.style.backgroundColor = bg;
  }

  function resetBtnSoon(ms = 2000) {
    setTimeout(() => {
      const btn = document.getElementById(BTN_ID);
      if (!btn) return;
      btn.style.backgroundColor = "#007cba";
      btn.textContent = "🚛 Add Stock | Lisca";
      ensureButton(); // her-evalueer enabled state
    }, ms);
  }

  function fail(msg) {
    setBtnStatus(msg, "#E06666");
    resetBtnSoon(2500);
  }

  async function onClick() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    try {
      if (!isLisca()) return fail("❌ Geen Lisca product");

      const table = document.querySelector(TABLE_SELECTOR);
      if (!table) return fail("❌ #tabs-3 is nog niet klaar");

      setBtnStatus("⏳ Lezen vanaf klembord...");

      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText) return fail("❌ Geen HTML op klembord");

      const parser = new DOMParser();
      const doc = parser.parseFromString(clipboardText, "text/html");

      const pid = document.querySelector(PID_SELECTOR)?.value?.trim();
      const htmlText = doc.body.textContent || doc.body.innerHTML || "";
      if (!pid || !htmlText.includes(pid)) {
        return fail(`❌ PID mismatch of ontbreekt (${pid || "geen PID"})`);
      }

      const matrix = doc.querySelector(".um-prodmatrix table");
      if (!matrix) return fail("❌ Geen Lisca matrix gevonden");

      // Headers (kolommen) — meestal band/maat
      const headers = [...matrix.querySelectorAll("thead th")]
        .slice(1)
        .map((th) => (th.textContent || "").trim());

      const rows = matrix.querySelectorAll("tbody tr");
      const stockMap = new Map();

      rows.forEach((row) => {
        const cells = [...row.querySelectorAll("td")];
        const firstText = cells[0]?.querySelector("div")?.textContent?.trim() || "";
        const isSingleRow = rows.length === 1 || /^[\s0-]+$/i.test(firstText);
        const cupmaat = isSingleRow ? "" : firstText; // kan leeg blijven bij S-M-L tabellen

        cells.slice(1).forEach((td, i) => {
          const stockText = td.querySelector(".prodmatrix-stock-status")?.textContent || "";
          const match = stockText.match(/\((\d+)\)/);
          const amount = parseInt(match?.[1] || "0", 10);

          if (amount > 0) {
            const maat = `${headers[i]}${cupmaat}`.replace(/\s+/g, "").toUpperCase();
            const stock = amount > 4 ? 5 : 1; // >4 → 5, 1–4 → 1
            stockMap.set(maat, stock);
          }
        });
      });

      // Schrijf terug naar DDO
      const ddoRows = [...document.querySelectorAll("#tabs-3 table.options tr")]
        .filter((r) => r.querySelector("input[type='text']"));

      let updated = 0;
      ddoRows.forEach((row) => {
        const maat = row.querySelector("td input")?.value?.trim()?.toUpperCase();
        const stockInput = row.querySelector("input[name*='[stock]']");
        if (!maat || !stockInput) return;

        const value = stockMap.get(maat);
        if (value !== undefined) {
          stockInput.value = value;
          stockInput.dispatchEvent(new Event("input", { bubbles: true }));
          updated++;
        }
      });

      setBtnStatus(`✅ Stock voor ${updated} maten ingevuld`, "#2ecc71");
      resetBtnSoon();
    } catch (err) {
      console.error("❌ Verwerkingsfout:", err);
      fail("❌ Fout bij verwerken");
    }
  }

  // --- Observeer DOM-mutaties zodat de knop “meeloopt” met lazy loads/tabwissels
  const observer = new MutationObserver(() => {
    ensureButton(); // idempotent
  });

  function startObserver() {
    try {
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      console.warn("Observer kon niet starten:", e);
    }
  }

  // --- Lifecycle hooks: terug naar tab / navigatie
  window.addEventListener("pageshow", ensureButton);
  window.addEventListener("visibilitychange", () => {
    if (!document.hidden) ensureButton();
  });
  window.addEventListener("hashchange", ensureButton);
  window.addEventListener("popstate", ensureButton);

  // Eerste init
  ensureButton();
  startObserver();
})();
