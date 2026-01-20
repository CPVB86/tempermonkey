// ==UserScript==
// @name         DDO | EAN Autopaster
// @version      1.8
// @description  Plak EAN codes automatisch in #tabs-3 op basis van maat en Supplier PID
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/ean-autopaster.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/ean-autopaster.user.js
// ==/UserScript==

(function () {
  "use strict";

  const BTN_ID = "ean-autopaster-btn";
  const TABLE_SELECTOR = "#tabs-3 table.options";
  const PID_SELECTOR = '#tabs-1 input[name="supplier_pid"]';
  const BRAND_TITLE_SELECTOR = "#tabs-1 #select2-brand-container";

  // Blokkeer-merken (regex, vangt varianten als "Lisca Selection" en "Linga Dore")
  const BLOCKED_BRANDS = [/^lisca/i, /^linga\s*dore/i];

  const SIZE_MAP = { "2XL": "XXL", "3XL": "XXXL", "4XL": "XXXXL" };
  const normalizeSize = (s) => {
    if (!s) return "";
    let t = String(s).trim().toUpperCase().replace(/\s+/g, "");
    if (SIZE_MAP[t]) t = SIZE_MAP[t];
    return t;
  };

  const getBrandTitle = () =>
    document.querySelector(BRAND_TITLE_SELECTOR)?.title?.trim() || "";

  const isBlockedBrand = () => {
    const title = getBrandTitle();
    return BLOCKED_BRANDS.some((re) => re.test(title));
  };

function ensureButton() {
  if (!document.body) return;

  let btn = document.getElementById(BTN_ID);
  if (!btn) {
    btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "📦 EAN Autopaster";
    btn.style.cssText = `
      position: fixed;
      right: 10px;
      top: 50px;
      z-index: 999999;
      padding: 10px 12px;
      background: #007cba;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,.15);
      font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    `;
    document.body.appendChild(btn);
    btn.addEventListener("click", onPasteClick);
  }

  const tableReady = !!document.querySelector(TABLE_SELECTOR);
  const blocked = isBlockedBrand(); // true bij Lisca of Linga Dore (varianten)

  // NIEUW: volledig verbergen bij geblokkeerd merk
  btn.style.display = blocked ? "none" : "";

  if (blocked) return; // niets meer doen als hij verborgen is

  // Anders normale enable/disable op basis van tabel-status
  btn.disabled = !tableReady;
  btn.style.opacity = tableReady ? "1" : ".55";
  btn.title = tableReady
    ? "Plak EAN's vanaf je klembord"
    : "Wachten tot #tabs-3 geladen is...";
}


  async function onPasteClick() {
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;

    try {
      btn.textContent = "⏳ Lezen vanaf klembord...";
      const raw = await navigator.clipboard.readText();
      if (!raw) return fail("❌ Geen klembordgegevens");

      const data = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
  const [maat, ean, pid, stock] = line.split("\t");
  return { maat, ean, pid, stock };
});

      const supplierPid = document.querySelector(PID_SELECTOR)?.value?.trim();
      if (!supplierPid) return fail("❌ Geen Supplier PID");

      const filtered = data
  .map((r) => ({
    ...r,
    pid: r.pid?.trim().toUpperCase(),
    stock: (r.stock ?? "").trim(), // kan leeg zijn
    _normMaat: normalizeSize(r.maat),
  }))
  .filter((r) => r.pid && supplierPid.toUpperCase().startsWith(r.pid));

      if (filtered.length === 0)
        return fail(`❌ Geen matches voor PID: ${supplierPid}`);

      const table = document.querySelector(TABLE_SELECTOR);
      if (!table) return fail("❌ #tabs-3 is nog niet klaar");

      const rows = table.querySelectorAll("tr");
      let matched = 0;
let stockUpdated = 0;

rows.forEach((row) => {
  const cells = row.querySelectorAll("td");
  if (cells.length < 2) return;

  // maat uit de eerste kolom
  const maatInput = cells[0].querySelector("input");
  const maatCellRaw = maatInput ? maatInput.value : "";
  const maatCell = normalizeSize(maatCellRaw);

  const eanInput = row.querySelector(
    'input[name^="options"][name$="[barcode]"]'
  );
  const stockInput = row.querySelector(
    'input[name^="options"][name$="[stock]"]'
  );

  if (!maatCell || !eanInput) return;

  const match = filtered.find((entry) => entry._normMaat === maatCell);
  if (!match) return;

  // EAN plakken
  if (match.ean) {
    eanInput.value = match.ean;
    eanInput.dispatchEvent(new Event("input", { bubbles: true }));
    matched++;
  }

  // Stock plakken (optioneel)
  if (match.stock !== "" && stockInput) {
    stockInput.value = match.stock;
    stockInput.dispatchEvent(new Event("input", { bubbles: true }));
    stockUpdated++;
  }
});

      btn.style.backgroundColor = "#2ecc71";
      btn.textContent = `📦 ${matched} EAN's geplakt! + ${stockUpdated} stock bijgewerkt!`;
      setTimeout(resetBtn, 2000);
    } catch (e) {
      console.error("❌ Fout bij plakken:", e);
      fail("❌ Fout bij plakken");
    }
  }

  function fail(text) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.textContent = text;
    btn.style.backgroundColor = "#E06666";
    setTimeout(resetBtn, 2500);
  }

  function resetBtn() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.style.backgroundColor = "#007cba";
    btn.textContent = "📦 EAN Autopaster";
    ensureButton(); // hercheck merk & tabel
  }

  // Observer + lifecycle hooks zodat de status meeverandert bij lazy loads/tabwissels
  const observer = new MutationObserver(() => ensureButton());
  function startObserver() {
    try {
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    } catch {}
  }

  window.addEventListener("pageshow", ensureButton);
  window.addEventListener("visibilitychange", () => {
    if (!document.hidden) ensureButton();
  });
  window.addEventListener("hashchange", ensureButton);
  window.addEventListener("popstate", ensureButton);

  ensureButton();
  startObserver();
})();
