// ==UserScript==
// @name         EAN Scrape - LingaDore
// @version      3.3
// @description  Scrape de EAN code direct in het juiste inputfield
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/ean-scrape-lingadore.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/ean-scrape-lingadore.user.js
// @grant        GM_xmlhttpRequest
// @connect      b2b.lingadore.com
// ==/UserScript==

(function () {
  "use strict";

  // ---------------- Debug ----------------
  const DEBUG = true;
  const log = (...a) => DEBUG && console.log("[EAN]", ...a);

  // ---------------- Helpers ----------------
  const SIZE_MAP_STD = {}; // bewust leeg

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
    let t = String(raw)
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/\(.*?\)/g, "")
      .trim();
    return SIZE_MAP_STD[t] || t;
  }

  function parseBraSize(s) {
    const clean = String(s || "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/\(.*?\)/g, "");

    const m = clean.match(/^(\d{2,3})([A-Z\/+]{0,4})?$/);
    if (!m) return { band: "", cup: "" };

    const band = m[1];
    const cup = (m[2] || "").replace(/[^A-Z]/g, "");
    return { band, cup };
  }

  const sanitizeCup = c => String(c || "").toUpperCase().replace(/[^A-Z]/g, "");

  function parsePid(pid) {
    pid = String(pid || "").trim();
    const parts = pid.split("-");
    if (parts.length < 2) return { model: pid, colorKey: "" };

    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];

    if (/^[A-Za-z]{1,3}$/.test(last) && /^\d+$/.test(prev)) {
      return { model: parts.slice(0, -2).join("-"), colorKey: `${prev}-${last.toUpperCase()}` };
    }

    return { model: parts.slice(0, -1).join("-"), colorKey: last };
  }

  const baseColor = ck => String(ck).replace(/-\s*[A-Z]{1,3}$/i, "");
  const colorWithCup = (ck, cup) => `${baseColor(ck)}-${sanitizeCup(cup)}`;
  const hasCupInColor = ck => /-\s*[A-Z]{1,3}$/i.test(ck);

  const toB64NoPad = txt => btoa(txt).replace(/=+$/, "");

  function isLingaBrand() {
    const tab1 = document.querySelector("#tabs-1");
    if (!tab1) return false;

    for (const el of tab1.querySelectorAll("select,[role='combobox']")) {
      const opt = el.tagName === "SELECT" ? el.options[el.selectedIndex] : null;
      const txt = (opt ? opt.textContent : el.textContent || el.value || "").trim().toLowerCase();
      if (txt.includes("lingadore")) return true;
    }

    return false;
  }

  // ---------------- Network ----------------
  const gmGet = url => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url,
      onload: r => resolve({ status: r.status, headers: r.responseHeaders || "", text: r.responseText || "" }),
      onerror: e => reject(e)
    });
  });

  async function fetchVariantModal_b64(model, colorKey, sizeKey, tries = 2) {
    const url = `https://b2b.lingadore.com/catalog/variant-modal/${toB64NoPad(model)}/${toB64NoPad(String(colorKey))}/${toB64NoPad(String(sizeKey))}`;

    for (let i = 1; i <= tries; i++) {
      const r = await gmGet(url);
      const ct = (r.headers.match(/content-type:[^\n]*/i) || [""])[0] || "";
      log("GET", url, "->", r.status, ct, "len", r.text?.length || 0, `try ${i}/${tries}`);

      if (r.status === 200 && r.text) return { ok: true, html: r.text };
      if (r.status >= 500 && i < tries) {
        await new Promise(res => setTimeout(res, 350));
        continue;
      }
      return { ok: false, html: "" };
    }
  }

  // ---------------- Parse EAN ----------------
  function parseEAN(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let ean = "";

    doc.querySelectorAll("table tr").forEach(tr => {
      const th = tr.querySelector("th,td");
      const td = th && th.nextElementSibling;
      if (!th || !td) return;

      const label = (th.textContent || "").trim().toLowerCase();
      if (label.includes("ean barcode")) {
        const m = (td.textContent || "").match(/\b(\d{8,14})\b/);
        if (m) ean = m[1];
      }
    });

    if (!ean) {
      const hits = (html.match(/\b\d{8,14}\b/g) || []);
      if (hits.length === 1) ean = hits[0];
    }

    return ean;
  }

  // ---------------- Scrape & Paste ----------------
  async function scrapePairs(model, colorKeyFromPid, tab3) {
    const rawSizes = [...tab3.querySelectorAll("table.options tr td:first-child")]
      .map(td => {
        const el = td.querySelector("input,select") || td;
        return normSize((el?.value ?? el?.textContent ?? "").trim());
      })
      .filter(Boolean);

    const need = [...new Set(rawSizes)];
    log("Maten op #tabs-3:", need);

    const pidHasCup = hasCupInColor(colorKeyFromPid);
    const out = [];

    for (const rowSize of need) {
      const { band, cup } = parseBraSize(rowSize);
      const rowIsBra = !!band && band !== rowSize;
      const treatAsBra = pidHasCup || rowIsBra;

      let ean = "";

      if (treatAsBra) {
        if (!band) {
          log("× geen band in rijmaat:", rowSize);
          continue;
        }

        let sizeKey = band;
        let colorKey = colorKeyFromPid.toUpperCase();

        if (!pidHasCup) {
          if (!cup) {
            log(`× BH verwacht cup maar rij "${rowSize}" bevat geen cup; sla over`);
            continue;
          }
          colorKey = colorWithCup(colorKey, cup);
        }

        let resp = await fetchVariantModal_b64(model, colorKey, sizeKey);
        if (resp.ok) ean = parseEAN(resp.html);

        if (!ean && pidHasCup && cup) {
          const altColor = colorWithCup(baseColor(colorKey), cup);
          if (altColor !== colorKey) {
            log("… fallback met alternatieve cup:", altColor);
            resp = await fetchVariantModal_b64(model, altColor, sizeKey);
            if (resp.ok) ean = parseEAN(resp.html);
          }
        }

        const pasteKey = rowIsBra && cup ? `${band}${cup}` : rowSize;
        if (ean) {
          out.push({ key: pasteKey, ean });
          if (!out.find(x => x.key === band)) out.push({ key: band, ean });
        }

        log(`maat ${rowSize} (BH) → EAN:`, ean || "(none)");
      } else {
        const candidates = altSizes(rowSize);
        const tried = [];

        for (const cand of candidates) {
          const resp = await fetchVariantModal_b64(model, colorKeyFromPid, cand);
          tried.push(cand);
          if (resp.ok) {
            ean = parseEAN(resp.html);
            if (ean) {
              out.push({ key: rowSize, ean });
              break;
            }
          }
        }

        log(`maat ${rowSize} (apparel) → tried ${tried.join(", ")} → ${ean || "(none)"}`);
      }
    }

    return out;
  }

  function pasteIntoTab3(pairs, tab3) {
    let matched = 0;

    for (const row of tab3.querySelectorAll("table.options tr")) {
      const cell = row.querySelector("td:first-child");
      const eanInput = row.querySelector('input[name^="options"][name$="[barcode]"]');
      if (!cell || !eanInput) continue;

      const el = cell.querySelector("input,select") || cell;
      const raw = (el?.value ?? el?.textContent ?? "").trim();
      const key = normSize(raw);

      const { band, cup } = parseBraSize(key);
      const hit = pairs.find(p => p.key === key) || (band ? pairs.find(p => p.key === band) : null);

      if (hit) {
        eanInput.value = hit.ean;
        eanInput.dispatchEvent(new Event("input", { bubbles: true }));
        log(`→ paste: ${key} → ${hit.ean}`);
        matched++;
      } else {
        log(`× no match for ${key}`);
      }
    }

    return matched;
  }

  // ---------------- UI ----------------
  function buildBtn() {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Scrape EAN";
    b.style.cssText = "position:fixed;right:10px;top:50px;z-index:9999;padding:10px 12px;background:#333;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.15);";
    return b;
  }

  function setBtn(b, ok, msg, ms = 2400) {
    b.textContent = msg;
    b.style.background = ok ? "#2ecc71" : "#e06666";
    if (ms) setTimeout(() => {
      b.style.background = "#333";
      b.textContent = "Scrape EAN";
    }, ms);
  }

  // ---------------- Main ----------------
  function init() {
    const tab3 = document.querySelector("#tabs-3");
    if (!tab3) return;
    if (!isLingaBrand()) return;

    const btn = buildBtn();
    tab3.prepend(btn);

    btn.addEventListener("click", async () => {
      console.groupCollapsed("Scrape EAN — Run");
      try {
        const pid = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value?.trim();
        log("PID:", pid);
        if (!pid) {
          setBtn(btn, false, "❌ Geen Supplier PID");
          console.groupEnd();
          return;
        }

        const { model, colorKey } = parsePid(pid);
        if (!colorKey) {
          setBtn(btn, false, "❌ Geen kleur in PID");
          console.groupEnd();
          return;
        }

        setBtn(btn, true, "⏳ Scrapen…", 0);
        const pairs = await scrapePairs(model, colorKey.toUpperCase(), tab3);
        log("Pairs:", pairs);

        if (!pairs.length) {
          setBtn(btn, false, "❌ Geen EAN’s gevonden");
          console.groupEnd();
          return;
        }

        const n = pasteIntoTab3(pairs, tab3);
        setBtn(btn, n > 0, n ? `✅ ${n} EAN’s geplakt` : "❌ Geen maat-match");
      } catch (e) {
        console.error("[EAN] Error:", e);
        setBtn(btn, false, "❌ Fout tijdens scrapen");
      } finally {
        console.groupEnd();
      }
    });
  }

  window.addEventListener("load", () => setTimeout(init, 600));
})();
