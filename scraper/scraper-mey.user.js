// ==UserScript==
// @name         EAN Scraper | Mey
// @version      1.5
// @description  Scrape EAN + remote stock from mey B2B, map to local stock levels and paste into tab #tabs-3. BH-maten via xvalues key parsing: CUP;COLOR;BAND, bv. E;3;90 => 90E. Filtert nu correct op kleurcode uit Supplier PID.
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
   * CONFIG
   ******************************************************************/
  const MEY_CTX = {
    dataareaid: "ME:NO",
    custid: "385468",
    assortid: "ddd8763b-b678-4004-ba8b-c64d45b5333c",
    ordertypeid: "NO",
    webSocketUniqueId:
      crypto?.randomUUID
        ? crypto.randomUUID()
        : `ws-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  };

  /******************************************************************
   * HELPERS
   ******************************************************************/
  const SIZE_SYNONYMS = {
    "2XL": ["2XL", "XXL"],
    "XXL": ["XXL", "2XL", "8/XXL"],

    "3XL": ["3XL", "XXXL"],
    "XXXL": ["XXXL", "3XL"],

    "4XL": ["4XL", "XXXXL"],
    "XXXXL": ["XXXXL", "4XL"],

    "5XL": ["5XL", "XXXXXL"],
    "XXXXXL": ["XXXXXL", "5XL"],

    "4/S": ["4/S", "S"],
    "S": ["S", "4/S"],

    "5/M": ["5/M", "M"],
    "M": ["M", "5/M"],

    "6/L": ["6/L", "L"],
    "L": ["L", "6/L"],

    "7/XL": ["7/XL", "XL"],
    "XL": ["XL", "7/XL"],

    "8/XXL": ["8/XXL", "XXL", "2XL"]
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
    return /^\d{2,3}[A-Z]{1,4}$/.test(t);
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

  function parsePidForMey(pid) {
    const s = String(pid || "").trim();

    // Meest betrouwbaar: "74800-3" of "74800-1747"
    const dash = s.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
    if (dash) {
      return {
        styleid: dash[1],
        colorKey: dash[2]
      };
    }

    const semi = s.match(/(?:^|;)(\d{4,})(?:;|$)/);
    const nums = s.match(/\d+/g) || [];

    if (!nums.length) {
      return {
        styleid: "",
        colorKey: ""
      };
    }

    const styleid = [...nums].sort((a, b) => b.length - a.length)[0] || "";

    const colorCandidates = nums.filter(
      n => n !== styleid && n.length >= 1 && n.length <= 6
    );

    const colorKey = (colorCandidates[colorCandidates.length - 1] || "").trim();

    const semiCandidate = semi?.[1] || "";
    const finalStyle =
      semiCandidate && semiCandidate.length >= styleid.length
        ? semiCandidate
        : styleid;

    return {
      styleid: finalStyle,
      colorKey
    };
  }

  function remoteToLocalStockLevel(remoteStock) {
    const n = Number(remoteStock);

    if (!Number.isFinite(n) || n <= 0) return 1;
    if (n === 1) return 1;
    if (n === 2) return 2;
    if (n === 3) return 3;
    if (n === 4) return 4;

    return 5;
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
          accept: "application/json, text/plain, */*"
        },
        withCredentials: true,
        onload: r =>
          resolve({
            status: r.status,
            text: r.responseText || ""
          }),
        onerror: e => reject(e)
      });
    });

  function buildMeyUrl() {
    const uniq = `${Date.now()}r${Math.floor(Math.random() * 1000)}`;
    return `https://meyb2b.com/b2bapi?-/${uniq}/OrderDetail/collection`;
  }

  async function fetchOrderDetailCollection(styleid, zkey = "*") {
    const url = buildMeyUrl();

    const payload = [
      {
        _getparams: {
          "": "undefined"
        },
        _webSocketUniqueId: MEY_CTX.webSocketUniqueId,
        _url: "OrderDetail/collection",
        _dataareaid: MEY_CTX.dataareaid,
        _agentid: null,
        _custid: String(MEY_CTX.custid),
        _method: "read",
        styles: [
          {
            custareaid: "ME",
            styleareaid: "NO",
            styleid: String(styleid),
            variantid: "*",
            zkey: String(zkey || "*")
          }
        ],
        assortid: MEY_CTX.assortid,
        ordertypeid: MEY_CTX.ordertypeid
      }
    ];

    log("POST", url, payload);

    const r = await gmPostJson(url, payload);

    log("→ status", r.status, "len", r.text.length);

    if (r.status !== 200) {
      throw new Error(`MEY API HTTP ${r.status}`);
    }

    return JSON.parse(r.text);
  }

  /******************************************************************
   * PARSE EAN + STOCK
   *
   * Apparel:
   * "*;1747;XS" => XS
   *
   * BH:
   * "E;3;90"    => cup E, kleur 3, omvang 90 => 90E
   * "E;1747;90" => cup E, kleur 1747, omvang 90 => 90E
   *
   * Belangrijk:
   * Alleen de kleur uit Supplier PID wordt gebruikt.
   ******************************************************************/
  function parseMeyPairs(json, preferredColorKey = "") {
    const resultArrRaw = json?.[0]?.result || [];
    const resultArr = Array.isArray(resultArrRaw) ? resultArrRaw : [resultArrRaw];

    if (!resultArr.length) {
      return {
        pairs: [],
        usedColorKey: ""
      };
    }

    const r0 = resultArr.find(r => r?.xvalues) || resultArr[0];

    const xvalues = r0?.xvalues || {};
    const ykeys = r0?.ykeys || [];

    const fallbackColorKey = ykeys.length === 1 ? String(ykeys[0]) : "";
    const colorKey = String(preferredColorKey || fallbackColorKey || "").trim();

    log("parseMeyPairs colorKey:", colorKey);

    const map = new Map();

    for (const [k, v] of Object.entries(xvalues)) {
      const ean = String(v?.ean || "").trim();
      const stock = Number(v?.stock ?? 0);

      // Ghost variant negeren: geen EAN én geen voorraad
      if ((!ean || ean.length < 8) && (!Number.isFinite(stock) || stock <= 0)) {
        continue;
      }

      /**************************************************************
       * BH key: CUP;COLOR;BAND
       *
       * Voorbeeld:
       * E;3;90     => 90E zwart
       * E;1747;90  => 90E roze
       **************************************************************/
      const mBra = String(k).match(/^([A-Z]{1,4});([^;]+);(\d{2,3})$/i);

      if (mBra) {
        const cup = String(mBra[1]).toUpperCase();
        const keyColor = String(mBra[2]).trim();
        const band = String(mBra[3]).toUpperCase();

        if (colorKey && keyColor !== colorKey) {
          continue;
        }

        const key = `${band}${cup}`;

        if (!map.has(key)) {
          map.set(key, {
            ean,
            stock
          });

          log("BH match:", k, "→", key, "kleur:", keyColor, "ean:", ean);
        }

        continue;
      }

      /**************************************************************
       * Apparel / 1D key
       *
       * Vaak iets als:
       * *;1747;XS
       **************************************************************/
      if (colorKey && String(k).startsWith("*;") && !String(k).includes(`;${colorKey};`)) {
        continue;
      }

      const size = normSize(v?.size || "");

      if (!size) {
        continue;
      }

      if (!map.has(size)) {
        map.set(size, {
          ean,
          stock
        });

        log("Size match:", k, "→", size, "ean:", ean);
      }
    }

    const pairs = [...map.entries()].map(([key, d]) => ({
      key,
      ean: d.ean || "",
      stock: d.stock ?? 0
    }));

    return {
      pairs,
      usedColorKey: colorKey
    };
  }

  /******************************************************************
   * PASTE INTO TAB 3
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
      if (!hit) continue;

      if (doEan) {
        const eanInput = row.querySelector(
          'input[name^="options"][name$="[barcode]"]'
        );

        if (eanInput && hit.ean) {
          eanInput.value = hit.ean;
          eanInput.dispatchEvent(new Event("input", { bubbles: true }));
          matchedEan++;
          log(`→ EAN ${key} = ${hit.ean}`);
        }
      }

      if (doStock) {
        const stockInput = row.querySelector(
          'input[name^="options"][name$="[stock]"]'
        );

        if (stockInput) {
          const level = remoteToLocalStockLevel(hit.stock);
          stockInput.value = String(level);
          stockInput.dispatchEvent(new Event("input", { bubbles: true }));
          matchedStock++;
          log(`→ STOCK ${key} remote=${hit.stock} → local=${level}`);
        }
      }
    }

    return {
      matchedEan,
      matchedStock
    };
  }

  /******************************************************************
   * AUTOSAVE
   ******************************************************************/
  function findUpdateProductButton() {
    return document.querySelector(
      'input[type="submit"][name="edit"][value="Update product"]'
    );
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

    if (ms) {
      setTimeout(() => {
        b.style.background = "#333";
        b.textContent = "Scrape MEY";
      }, ms);
    }
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
      console.groupCollapsed(
        `Scrape MEY — ${mode}${autosave ? " + autosave" : ""}`
      );

      try {
        const pid = document
          .querySelector('#tabs-1 input[name="supplier_pid"]')
          ?.value
          ?.trim();

        log("PID:", pid);

        if (!pid) {
          setBtn(btn, false, "❌ Geen Supplier PID");
          console.groupEnd();
          return;
        }

        const { styleid, colorKey } = parsePidForMey(pid);

        log("MEY styleid:", styleid, "colorKey:", colorKey);

        if (!styleid) {
          setBtn(btn, false, "❌ Geen styleid in PID");
          console.groupEnd();
          return;
        }

        setBtn(btn, true, "⏳ Scrapen…", 0);

        // Belangrijk: kleurcode meesturen als zkey
        const json = await fetchOrderDetailCollection(styleid, colorKey || "*");

        // Belangrijk: daarna ook nog filteren binnen xvalues
        const parsed = parseMeyPairs(json, colorKey);

        let pairs = parsed.pairs;

        if (!pairs.length) {
          setBtn(btn, false, "❌ Geen data gevonden");
          console.groupEnd();
          return;
        }

        const expanded = [];

        for (const p of pairs) {
          expanded.push(p);

          if (!isBraSizeLabel(p.key)) {
            for (const alt of altSizes(p.key)) {
              if (alt !== p.key) {
                expanded.push({
                  ...p,
                  key: alt
                });
              }
            }
          }
        }

        const doEan = mode === "all" || mode === "ean";
        const doStock = mode === "all" || mode === "stock";

        const res = pasteIntoTab3(expanded, tab3, {
          doEan,
          doStock
        });

        const ok = res.matchedEan + res.matchedStock > 0;

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

    btn.addEventListener("click", () =>
      run({
        mode: "all",
        autosave: false
      })
    );

    window.addEventListener(
      "keydown",
      ev => {
        if (!document.querySelector("#tabs-3")) return;
        if (isTypingTarget(ev)) return;

        const k = ev.key.toLowerCase();

        if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "a") {
          ev.preventDefault();
          run({
            mode: "all",
            autosave: true
          });
          return;
        }

        if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "e") {
          ev.preventDefault();
          run({
            mode: "ean",
            autosave: false
          });
          return;
        }

        if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "s") {
          ev.preventDefault();
          run({
            mode: "stock",
            autosave: false
          });
        }
      },
      true
    );
  }

  window.addEventListener("load", () => setTimeout(init, 600));
})();
