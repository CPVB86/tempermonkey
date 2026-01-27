// ==UserScript==
// @name         VCP | Mey
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.1
// @description  Vergelijk local stock met remote stock (mey) — knop/progress via StockKit, geen inline-overschrijvingen. BH via key parsing (D;38;75 => 75D). Tolerante PID parsing + skip ghost variants.
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      meyb2b.com
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-mey.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-mey.user.js
// ==/UserScript==

(() => {
  "use strict";

  // ---------- Config ----------
  const CONFIG = {
    LOG: {
      status:  "both",    // 'console' | 'logboek' | 'both' | 'off'
      perMaat: "console", // maten-overzicht in console
      debug:   false,
    }
  };

  const TIMEOUT = 15000;
  const SUPPORTED_BRANDS = new Set(["mey"]);

  const MEY_CTX = {
    dataareaid: "ME:NO",
    custid: "385468",
    assortid: "ddd8763b-b678-4004-ba8b-c64d45b5333c",
    ordertypeid: "NO",
    webSocketUniqueId: (crypto?.randomUUID ? crypto.randomUUID() : `ws-${Date.now()}-${Math.floor(Math.random()*1e6)}`)
  };

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const norm = (s = "") => String(s).toLowerCase().trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");

  // ---------- Logger ----------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== "undefined" && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek;
    },
    _on(mode, kind) {
      const m = (CONFIG.LOG[kind] || "off").toLowerCase();
      return m === mode || m === "both";
    },
    status(id, txt) {
      const sid = String(id);
      if (this._on("console", "status")) console.info(`[mey][${sid}] status: ${txt}`);
      if (this._on("logboek", "status")) {
        const lb = this.lb();
        if (lb?.resultaat) lb.resultaat(sid, txt);
        else if (typeof unsafeWindow !== "undefined" && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(sid, txt);
      }
    },
    perMaat(id, report) {
      if (!this._on("console", "perMaat")) return;
      console.groupCollapsed(`[mey][${id}] maatvergelijking`);
      try {
        const rows = report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: Number.isFinite(r.remote) ? r.remote : "—",
          expected: Number.isFinite(r.expected) ? r.expected : "—",
          actie: r.actie
        }));
        console.table(rows);
      } finally { console.groupEnd(); }
    },
    debug(...a) { if (CONFIG.LOG.debug) console.info("[mey][debug]", ...a); }
  };

  // ---------- GM POST ----------
  function gmPost(url, jsonBody) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        withCredentials: true,
        timeout: TIMEOUT,
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Accept": "application/json, text/plain, */*",
        },
        data: JSON.stringify(jsonBody),
        onload: (r) => (r.status >= 200 && r.status < 400) ? resolve(r.responseText || "") : reject(new Error(`HTTP ${r.status} @ ${url}`)),
        onerror: reject,
        ontimeout: () => reject(new Error(`timeout @ ${url}`)),
      });
    });
  }

  function buildMeyUrl() {
    const uniq = `${Date.now()}r${Math.floor(Math.random() * 1000)}`;
    return `https://meyb2b.com/b2bapi?-/${uniq}/OrderDetail/collection`;
  }

  // ✅ tolerant PID parse: supports "1230081-1718", "ME;NO;1230081;*;*/1718", etc.
  function parsePid(pid) {
    const s = String(pid || "").trim();

    // 1) clean "1230081-1718"
    let m = s.match(/^\s*(\d+)\s*[-_]\s*(\d+)\s*$/);
    if (m) return { styleid: m[1], colorKey: m[2] };

    // 2) if contains .../1718 at end
    m = s.match(/\/\s*(\d{3,6})\s*$/);
    const trailingColor = m?.[1] || "";

    // 3) all numbers
    const nums = s.match(/\d+/g) || [];
    if (!nums.length) return { styleid: "", colorKey: "" };

    // styleid = longest number (usually article no.)
    const styleid = [...nums].sort((a,b) => b.length - a.length)[0] || "";

    // colorKey = last 3-6 digit number not equal styleid (prefer trailing)
    const colorCandidates = nums.filter(n => n !== styleid && n.length >= 3 && n.length <= 6);
    const colorKey = (trailingColor || colorCandidates[colorCandidates.length - 1] || "").trim();

    return { styleid, colorKey };
  }

  function normSize(raw) {
    return String(raw || "").toUpperCase().trim().replace(/\s+/g, "");
  }

  // remote count -> local (1..5)
  function remoteToLocalStockLevel(remoteStock) {
    const n = Number(remoteStock);
    if (!Number.isFinite(n) || n <= 0) return 0
    if (n === 1) return 0
    if (n === 2) return 1
    if (n === 3) return 3;
    if (n === 4) return 4;
    return 5;
  }

  // ✅ key parsing: BH keys like "D;38;75" => "75D"
  function keyToMaat(k, v) {
    const ks = String(k || "");

    // bra key: CUP;something;BAND
    const mBra = ks.match(/^([A-Z]{1,4})\;[^;]*\;(\d{2,3})$/i);
    if (mBra) {
      const cup = String(mBra[1]).toUpperCase();
      const band = String(mBra[2]).toUpperCase();
      return `${band}${cup}`; // 75D
    }

    // apparel: use v.size
    const size = normSize(v?.size);
    return size || "";
  }

  // ✅ remoteMap: maatKey -> remoteStock (only real variants; skip ghost stock<=0 && no EAN)
  async function fetchRemoteMap(styleid, colorKey) {
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
        zkey: "*"
      }],
      assortid: MEY_CTX.assortid,
      ordertypeid: MEY_CTX.ordertypeid
    }];

    const text = await gmPost(url, payload);
    const json = JSON.parse(text);

    const res0 = json?.[0]?.result?.[0];
    const xvalues = res0?.xvalues || {};

    const map = {}; // maat -> stock

    for (const [k, v] of Object.entries(xvalues)) {
      // apparel keys filteren op kleur: "*;1718;XS"
      if (colorKey && String(k).startsWith("*;") && !String(k).includes(`;${colorKey};`)) continue;

      const stock = Number(v?.stock ?? 0);
      const ean = String(v?.ean || "").trim();

      // ✅ ghost variant skip
      if ((!ean || ean.length < 8) && (!Number.isFinite(stock) || stock <= 0)) continue;

      const maat = keyToMaat(k, v);
      if (!maat) continue;

      map[maat] = stock;
    }

    return map;
  }

  function applyRulesAndMark(localTable, remoteMap) {
    const rows = localTable.querySelectorAll("tbody tr");
    const report = [];

    rows.forEach(row => {
      const sizeCell = row.children[0];
      const localCell = row.children[1];

      const maat = normSize(row.dataset.size || sizeCell?.textContent || "");
      const local = parseInt(String(localCell?.textContent || "").trim(), 10) || 0;

      // alleen toepassen op maten die remote heeft
      if (!Object.prototype.hasOwnProperty.call(remoteMap, maat)) return;

      const remote = Number(remoteMap[maat] ?? 0);
      const expected = remoteToLocalStockLevel(remote);

      // reset visuals
      row.style.background = "";
      row.style.transition = "background-color .25s";
      row.title = "";
      row.classList.remove("status-green", "status-red");
      delete row.dataset.status;

      let actie = "none";

      if (local !== expected) {
        if (local < expected) {
          row.style.background = "#d4edda";
          row.title = `Bijboeken (expected ${expected}, remote ${remote})`;
          row.dataset.status = "add";
          row.classList.add("status-green");
          actie = "bijboeken";
        } else {
          row.style.background = "#f8d7da";
          row.title = `Uitboeken (expected ${expected}, remote ${remote})`;
          row.dataset.status = "remove";
          row.classList.add("status-red");
          actie = "uitboeken";
        }
      }

      report.push({ maat, local, remote, expected, actie });
    });

    return report;
  }

  function bepaalLogStatus(report, remoteMap) {
    const remoteLeeg = !remoteMap || Object.keys(remoteMap).length === 0;
    if (remoteLeeg) return "niet-gevonden";

    const diffs = report.filter(r => r.actie === "bijboeken" || r.actie === "uitboeken").length;
    if (diffs === 0) return "ok";
    return "afwijking";
  }

  function isNotFoundError(err) {
    const msg = String(err && err.message || "").toUpperCase();
    if (/HTTP\s(401|403|404|410)/.test(msg)) return true;
    if (/HTTP\s5\d{2}/.test(msg)) return true;
    if (/SYNTAXERROR/.test(msg)) return true;
    return false;
  }

  // ---------- Main ----------
  async function run(btn) {
    if (typeof StockKit === "undefined" || !StockKit.makeProgress) {
      alert("StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.");
      return;
    }

    const progress = StockKit.makeProgress(btn);
    const tables = Array.from(document.querySelectorAll("#output table"));
    if (!tables.length) { alert("Geen tabellen gevonden in #output."); return; }

    progress.start(tables.length);

    let totalMutations = 0, ok = 0, fail = 0, idx = 0;

    for (const table of tables) {
      idx++;

      const pid = (table.id || "").trim(); // verwacht: styleid-colorKey (maar tolerant)
      const label = table.querySelector("thead th[colspan]")?.textContent?.trim() || pid || "onbekend";
      const anchorId = pid || label;

      try {
        if (!pid) {
          Logger.status(anchorId, "niet-gevonden");
          Logger.perMaat(anchorId, []);
          progress.setDone(idx);
          continue;
        }

        const { styleid, colorKey } = parsePid(pid);
        if (!styleid) {
          Logger.status(anchorId, "niet-gevonden");
          Logger.perMaat(anchorId, []);
          progress.setDone(idx);
          continue;
        }

        const remoteMap = await fetchRemoteMap(styleid, colorKey);
        if (!remoteMap || Object.keys(remoteMap).length === 0) {
          Logger.status(anchorId, "niet-gevonden");
          Logger.perMaat(anchorId, []);
          progress.setDone(idx);
          continue;
        }

        const report = applyRulesAndMark(table, remoteMap);
        const diffs = report.filter(r => r.actie === "bijboeken" || r.actie === "uitboeken").length;
        totalMutations += diffs;

        const status = bepaalLogStatus(report, remoteMap);
        Logger.status(anchorId, status);
        Logger.perMaat(anchorId, report);

        ok++;
      } catch (e) {
        console.error("[mey] fout:", e);
        if (isNotFoundError(e)) {
          Logger.status(anchorId, "niet-gevonden");
          Logger.perMaat(anchorId, []);
        } else {
          Logger.status(anchorId, "afwijking");
        }
        fail++;
      }

      progress.setDone(idx);
      await delay(80);
    }

    progress.success(totalMutations);
    if (CONFIG.LOG.debug) console.info(`[mey] verwerkt: ${ok + fail} | geslaagd: ${ok} | fouten: ${fail} | mutaties: ${totalMutations}`);
  }

  // ---------- UI ----------
  function getSelectedBrandLabel() {
    const sel = $("#leverancier-keuze");
    if (!sel) return "mey";
    const opt = sel.options[sel.selectedIndex];
    let label = (opt?.text || "").trim();
    if (!label || /kies\s+leverancier/i.test(label) || /^-+\s*kies/i.test(label)) label = (sel.value || "").trim();
    return label || "mey";
  }

  function isSupportedSelected() {
    const dd = $("#leverancier-keuze");
    if (!dd) return true;
    const byValue = norm(dd.value || "");
    const byText  = norm((dd.options[dd.selectedIndex]?.text || ""));
    return SUPPORTED_BRANDS.has(byValue) || SUPPORTED_BRANDS.has(byText);
  }

  function addButton() {
    if (document.getElementById("check-mey-btn")) return;

    if (!document.getElementById("stockkit-css")) {
      const link = document.createElement("link");
      link.id = "stockkit-css";
      link.rel = "stylesheet";
      link.href = "https://lingerieoutlet.nl/tools/stock/common/stockkit.css";
      document.head.appendChild(link);
    }

    const btn = document.createElement("button");
    btn.id = "check-mey-btn";
    btn.className = "sk-btn";
    btn.textContent = `🔍 Check stock ${getSelectedBrandLabel()}`;
    Object.assign(btn.style, { position: "fixed", top: "8px", right: "250px", zIndex: 9999, display: "none" });
    btn.addEventListener("click", () => run(btn));
    document.body.appendChild(btn);

    const outputHasTables = () => !!document.querySelector("#output table");

    function isBusy() { return btn.classList.contains("is-busy"); }
    function isTerminal() {
      const t = (btn.textContent || "").trim();
      return /^(?:.*)?Klaar:/u.test(t) || t.includes("❌ Fout");
    }
    function maybeUpdateLabel() {
      if (!isBusy() && !isTerminal()) btn.textContent = `🔍 Check stock ${getSelectedBrandLabel()}`;
    }

    function toggle() {
      btn.style.display = (outputHasTables() && isSupportedSelected()) ? "block" : "none";
      if (btn.style.display === "block") maybeUpdateLabel();
    }

    const out = $("#output");
    if (out) new MutationObserver(toggle).observe(out, { childList: true, subtree: true });

    const select = $("#leverancier-keuze");
    if (select) select.addEventListener("change", () => { maybeUpdateLabel(); toggle(); });

    const upload = $("#upload-container");
    if (upload) new MutationObserver(toggle).observe(upload, { attributes: true, attributeFilter: ["style", "class"] });

    toggle();
  }

  (document.readyState === "loading") ? document.addEventListener("DOMContentLoaded", addButton) : addButton();
})();
