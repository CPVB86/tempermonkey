// ==UserScript==
// @name         EAN Scraper | Mey
// @version      1.4
// @description  Scrape EAN + remote stock from mey B2B, map to local stock levels and paste into tab #tabs-3. BH-maten via xvalues key parsing (bv. D;38;75 => 75D). Skip ghost variants: stock<=0 AND missing EAN. Includes hotkeys + autosave.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @author       C. P. v. Beek + GPT
// @grant        GM_xmlhttpRequest
// @connect      meyb2b.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-mey.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-mey.user.js
// ==/UserScript==

(function () {
  "use strict";

  /******************************************************************
   * DEBUG
   ******************************************************************/
  const DEBUG = true;
  const log = (...a) => DEBUG && console.log("[MEY]", ...a);

  /******************************************************************
   * CONFIG – afkomstig uit jouw Network payload
   ******************************************************************/
  const MEY_CTX = {
    dataareaid: "ME:NO",
    custid: "385468",
    assortid: "ddd8763b-b678-4004-ba8b-c64d45b5333c",
    ordertypeid: "NO",
    webSocketUniqueId:
      (crypto?.randomUUID ? crypto.randomUUID() : `ws-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  };

  /******************************************************************
   * HELPERS
   ******************************************************************/
  const SIZE_SYNONYMS = {
    "2XL": ["2XL", "XXL"],
    "XXL": ["XXL", "2XL"],
    "3XL": ["3XL", "XXXL"],
    "XXXL": ["XXXL", "3XL"],
    "4XL": ["4XL", "XXXXL"],
    "XXXXL": ["XXXXL", "4XL"],
    "5XL": ["5XL", "XXXXXL"],
    "XXXXXL": ["XXXXXL", "5XL"]
  };

  const altSizes = s => SIZE_SYNONYMS[s] || [s];

  function normSize(raw) {
    if (!raw) return "";
    return String(raw)
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/\(.*?\)/g, "")
      .trim();
  }

  function isBraSizeLabel(s) {
    const t = normSize(s);
    return /^\d{2,3}[A-Z]{1,4}$/.test(t); // AA/A/B/... tot 4 chars safe
  }

  function isTypingTarget(ev) {
    const t = ev.target;
    if (!t) return false;
    const tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function isMeyBrand() {
    const tab1 = document.querySelector("#tabs-1");
    if (!tab1) return false;
    for (const el of tab1.querySelectorAll("select,[role='combobox']")) {
      const opt = el.tagName === "SELECT" ? el.options[el.selectedIndex] : null;
      const t = (opt ? opt.textContent : el.textContent || el.value || "")
        .trim()
        .toLowerCase();
      if (t.includes("mey")) return true;
    }
    return false;
  }

  // PID tolerant: styleid (6-9 digits) + laatste 3-5 digits als kleur
function parsePidForMey(pid) {
  const s = String(pid || "").trim();

  // 1) Meest betrouwbaar: voor "1230081-1718"
  const dash = s.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  if (dash) {
    return { styleid: dash[1], colorKey: dash[2] };
  }

  // 2) Mey API id-achtige strings "ME;NO;1230081;*;*"
  const semi = s.match(/(?:^|;)(\d{4,})(?:;|$)/);
  // semi pakt het eerste lange nummer tussen ; ;
  // maar: we willen de beste kandidaat (meestal langste)
  const nums = s.match(/\d+/g) || [];
  if (!nums.length) return { styleid: "", colorKey: "" };

  // styleid = langste (meestal product nr)
  const styleid = [...nums].sort((a,b) => b.length - a.length)[0] || "";

  // colorKey = laatste "korte" nummer (3-6 digits) dat niet gelijk is aan styleid
  const colorCandidates = nums.filter(n => n !== styleid && n.length >= 3 && n.length <= 6);
  const colorKey = (colorCandidates[colorCandidates.length - 1] || "").trim();

  // als semi match bestaat en langer is dan styleid, gebruik die (extra safeguard)
  const semiCandidate = semi?.[1] || "";
  const finalStyle = (semiCandidate && semiCandidate.length >= styleid.length) ? semiCandidate : styleid;

  return { styleid: finalStyle, colorKey };
}


  // mapping remote -> local stock (zoals afgesproken)
  function remoteToLocalStockLevel(remoteStock) {
    const n = Number(remoteStock);
    if (!Number.isFinite(n) || n <= 0) return 1;
    if (n === 1) return 1;
    if (n === 2) return 2;
    if (n === 3) return 3;
    if (n === 4) return 4;
    return 5; // >4
  }

  /******************************************************************
   * NETWORK
   ******************************************************************/
  const gmPostJson = (url, data) =>
    new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        data: JSON.stringify(data),
        headers: {
          "content-type": "application/json;charset=UTF-8",
          "accept": "application/json, text/plain, */*"
        },
        withCredentials: true,
        onload: r => resolve({ status: r.status, text: r.responseText || "" }),
        onerror: e => reject(e)
      });
    });

  function buildMeyUrl() {
    const uniq = `${Date.now()}r${Math.floor(Math.random() * 1000)}`;
    return `https://meyb2b.com/b2bapi?-/${uniq}/OrderDetail/collection`;
  }

  async function fetchOrderDetailCollection(styleid, zkey = "*") {
    const url = buildMeyUrl();
    const payload = [{
      _getparams: { "": "undefined" },
      _webSocketUniqueId: MEY_CTX.webSocketUniqueId,
      _url: "OrderDetail/collection",
      _dataareaid: MEY_CTX.dataareaid,
      _agentid: null,
      _custid: String(MEY_CTX.custid),
      _method: "read",
      styles: [{
        custareaid: "ME",
        styleareaid: "NO",
        styleid: String(styleid),
        variantid: "*",
        zkey: String(zkey || "*")
      }],
      assortid: MEY_CTX.assortid,
      ordertypeid: MEY_CTX.ordertypeid
    }];

    log("POST", url, payload);
    const r = await gmPostJson(url, payload);
    log("→ status", r.status, "len", r.text.length);

    if (r.status !== 200) throw new Error(`MEY API HTTP ${r.status}`);
    return JSON.parse(r.text);
  }

  /******************************************************************
   * PARSE EAN + STOCK (apparel + bra)
   * - apparel: key "*;1718;XS" etc => use v.size
   * - bra: key "D;38;75" => cup=D band=75 => key "75D"
   * - SKIP ghost: if stock<=0 AND ean missing => ignore variant completely
   ******************************************************************/
  function parseMeyPairs(json, preferredColorKey = "") {
    const resultArr = json?.[0]?.result || [];
    if (!resultArr.length) return { pairs: [], usedColorKey: "" };

    const r0 = resultArr[0];
    const xvalues = r0.xvalues || {};
    const ykeys = r0.ykeys || [];
    const fallbackColorKey = (ykeys.length === 1 ? String(ykeys[0]) : "");
    const colorKey = (preferredColorKey || fallbackColorKey || "").trim();

    const map = new Map(); // key -> {ean, stock}

    for (const [k, v] of Object.entries(xvalues)) {
      // Filter op kleurKey waar mogelijk (apparel keys starten met "*;")
      if (colorKey && k.startsWith("*;") && !k.includes(`;${colorKey};`)) continue;

      const ean = String(v?.ean || "").trim();
      const stock = Number(v?.stock ?? 0);

      // ✅ SKIP ghost variants (jouw laatste touch)
      if ((!ean || ean.length < 8) && (!Number.isFinite(stock) || stock <= 0)) {
        // geen ean + geen voorraad => negeren (dus geen stock=1 plakken)
        continue;
      }

      // --- Detect bra key: CUP;something;BAND ---
      const mBra = String(k).match(/^([A-Z]{1,4})\;[^;]*\;(\d{2,3})$/i);
      if (mBra) {
        const cup = String(mBra[1]).toUpperCase();
        const band = String(mBra[2]).toUpperCase();
        const key = `${band}${cup}`;

        if (!map.has(key)) map.set(key, { ean, stock });
        continue;
      }

      // --- Default (apparel/1D): use v.size as key ---
      const size = normSize(v?.size || "");
      if (!size) continue;
      if (!map.has(size)) map.set(size, { ean, stock });
    }

    const pairs = [...map.entries()].map(([key, d]) => ({
      key,
      ean: d.ean || "",
      stock: d.stock ?? 0
    }));

    return { pairs, usedColorKey: colorKey };
  }

  /******************************************************************
   * PASTE INTO TAB 3
   * - Alleen maten die remote heeft
   * - Stock: alleen plakken als remote variant niet "ghost" was (die zaten al niet in pairs)
   ******************************************************************/
  function pasteIntoTab3(pairs, tab3, { doEan = true, doStock = true } = {}) {
    let matchedEan = 0;
    let matchedStock = 0;

    const bySize = new Map(pairs.map(p => [p.key, p]));

    for (const row of tab3.querySelectorAll("table.options tr")) {
      const cell = row.querySelector("td:first-child");
      if (!cell) continue;

      const sizeEl = cell.querySelector("input,select") || cell;
      const raw = (sizeEl?.value ?? sizeEl?.textContent ?? "").trim();
      const key = normSize(raw);

      const hit = bySize.get(key);
      if (!hit) continue; // ✅ niet in remote -> negeren

      if (doEan) {
        const eanInput = row.querySelector('input[name^="options"][name$="[barcode]"]');
        if (eanInput && hit.ean) {
          eanInput.value = hit.ean;
          eanInput.dispatchEvent(new Event("input", { bubbles: true }));
          matchedEan++;
          log(`→ EAN ${key} = ${hit.ean}`);
        }
      }

      if (doStock) {
        const stockInput = row.querySelector('input[name^="options"][name$="[stock]"]');
        if (stockInput) {
          const level = remoteToLocalStockLevel(hit.stock);
          stockInput.value = String(level);
          stockInput.dispatchEvent(new Event("input", { bubbles: true }));
          matchedStock++;
          log(`→ STOCK ${key} remote=${hit.stock} → local=${level}`);
        }
      }
    }

    return { matchedEan, matchedStock };
  }

  /******************************************************************
   * AUTOSAVE
   ******************************************************************/
  function findUpdateProductButton() {
    return document.querySelector('input[type="submit"][name="edit"][value="Update product"]');
  }

  function autoSaveProduct() {
    const btn = findUpdateProductButton();
    if (!btn) {
      log("! autosave: Update product button niet gevonden");
      return false;
    }
    btn.click();
    log("✓ autosave: Update product geklikt");
    return true;
  }

  /******************************************************************
   * UI
   ******************************************************************/
  function buildBtn() {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Scrape MEY";
    b.style.cssText =
      "position:fixed;right:10px;top:10px;z-index:9999;padding:10px 12px;" +
      "background:#333;color:#fff;border:none;border-radius:8px;font-weight:600;" +
      "cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.15);";
    return b;
  }

  function setBtn(b, ok, msg, ms = 2400) {
    b.textContent = msg;
    b.style.background = ok ? "#2ecc71" : "#e06666";
    if (ms) setTimeout(() => {
      b.style.background = "#333";
      b.textContent = "Scrape MEY";
    }, ms);
  }

  /******************************************************************
   * MAIN
   ******************************************************************/
  function init() {
    const tab3 = document.querySelector("#tabs-3");
    if (!tab3) return;
    if (!isMeyBrand()) return;

    const btn = buildBtn();
    tab3.prepend(btn);

    async function run({ mode = "all", autosave = false } = {}) {
      console.groupCollapsed(`Scrape MEY — ${mode}${autosave ? " + autosave" : ""}`);
      try {
        const pid = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value?.trim();
        log("PID:", pid);

        if (!pid) {
          setBtn(btn, false, "❌ Geen Supplier PID");
          console.groupEnd();
          return;
        }

        const { styleid, colorKey } = parsePidForMey(pid);
        if (!styleid) {
          setBtn(btn, false, "❌ Geen styleid in PID");
          console.groupEnd();
          return;
        }

        setBtn(btn, true, "⏳ Scrapen…", 0);

        const json = await fetchOrderDetailCollection(styleid, "*");
        const parsed = parseMeyPairs(json, colorKey);

        let pairs = parsed.pairs;

        if (!pairs.length) {
          setBtn(btn, false, "❌ Geen data gevonden");
          console.groupEnd();
          return;
        }

        // Expand synoniemen alleen voor lettermaten, niet voor BH keys (75D etc.)
        const expanded = [];
        for (const p of pairs) {
          expanded.push(p);
          if (!isBraSizeLabel(p.key)) {
            for (const alt of altSizes(p.key)) {
              if (alt !== p.key) expanded.push({ ...p, key: alt });
            }
          }
        }

        const doEan = (mode === "all" || mode === "ean");
        const doStock = (mode === "all" || mode === "stock");

        const res = pasteIntoTab3(expanded, tab3, { doEan, doStock });
        const ok = (res.matchedEan + res.matchedStock) > 0;

        setBtn(btn, ok, `✅ EAN: ${res.matchedEan} | Stock: ${res.matchedStock}`);

        if (autosave && ok) {
          setTimeout(() => autoSaveProduct(), 150);
        }
      } catch (e) {
        console.error("[MEY] Error:", e);
        setBtn(btn, false, "❌ Fout tijdens scrapen");
      } finally {
        console.groupEnd();
      }
    }

    // Button = run all, no autosave
    btn.addEventListener("click", () => run({ mode: "all", autosave: false }));

    // HOTKEYS
    window.addEventListener("keydown", (ev) => {
      if (!document.querySelector("#tabs-3")) return;
      if (isTypingTarget(ev)) return;

      const k = ev.key.toLowerCase();

      // Ctrl + Shift + A  → all + autosave
      if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "a") {
        ev.preventDefault();
        run({ mode: "all", autosave: true });
        return;
      }

      // Ctrl + Shift + E → EAN only
      if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "e") {
        ev.preventDefault();
        run({ mode: "ean", autosave: false });
        return;
      }

      // Ctrl + Shift + S → Stock only
      if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "s") {
        ev.preventDefault();
        run({ mode: "stock", autosave: false });
        return;
      }
    }, true);
  }

  window.addEventListener("load", () => setTimeout(init, 600));
})();
