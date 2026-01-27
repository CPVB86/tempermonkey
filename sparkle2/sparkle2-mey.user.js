// ==UserScript==
// @name         Sparkle 2 | Mey
// @version      1.4
// @description  Kopieert een SPARKLE payload naar het klembord (meyb2b.com) incl. descriptionHtml + reference.
// @match        https://meyb2b.com/*
// @match        https://www.meyb2b.com/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-mey.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-mey.user.js
// ==/UserScript==

(function () {
  "use strict";

  const BUTTON_CLASS = "copy-sparkle";
  const BUTTON_TEXT = "✨";

  /******************************************************************
   * Helpers
   ******************************************************************/
  const txt = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

  function normalizePrice(text) {
    const cleaned = String(text || "").replace(/[^\d,\.]/g, "").trim();
    if (!cleaned) return "";
    return cleaned.replace(",", ".");
  }

  function stripSeriePrefix(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^serie\s+/i, "")
      .replace(/^serie:\s*/i, "");
  }

  function toTitleCaseWords(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\b([a-zà-ÿ])/g, (m) => m.toUpperCase())
      .trim();
  }

  function stripLeadingNumeric(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\d+\s*/i, "")
      .trim();
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function extractStyleId() {
    const raw = txt(document.querySelector(".styleid"));
    const m = raw.match(/(\d{4,})/);
    return m ? m[1] : "";
  }

function extractColorKey() {
  // 1) probeer “actieve”/geselecteerde kleur (klassennamen kunnen verschillen)
  const candidates = [
    ".color.active[rel]",
    ".color.selected[rel]",
    ".color.is-active[rel]",
    ".color[aria-selected='true'][rel]",
    ".colorBullet.active",
    ".colorBullet.selected",
    ".colorBullet.is-active"
  ];

  // helper: vind dichtstbijzijnde .color[rel]
  const relFrom = (node) => {
    const c = node?.closest?.(".color[rel]") || null;
    const rel = c?.getAttribute?.("rel") || "";
    const m = rel.match(/(\d{2,})/);
    return m ? m[1] : "";
  };

  for (const sel of candidates) {
    const hit = document.querySelector(sel);
    const ck = relFrom(hit);
    if (ck) return ck;
  }

  // 2) fallback: eerste .color[rel] (oude gedrag)
  {
    const el = document.querySelector(".color[rel]");
    const rel = el?.getAttribute("rel") || "";
    const m = rel.match(/(\d{2,})/);
    if (m) return m[1];
  }

  // 3) laatste redmiddel: haal de numerieke code uit "1718 soft pink" in .colorName
  const cn = document.querySelector(".colorName");
  if (cn) {
    const links = [...cn.querySelectorAll("a")].map(a => txt(a)).filter(Boolean);
    const candidate = links.find(t => /^\d+\b/.test(t)) || "";
    const m = candidate.match(/^(\d+)/);
    if (m) return m[1];
  }

  return "";
}

  function extractColorName() {
    const cn = document.querySelector(".colorName");
    if (!cn) return "";
    const links = [...cn.querySelectorAll("a")].map(a => txt(a)).filter(Boolean);
    const candidate = links.find(t => /\d+\s+/.test(t)) || links[links.length - 1] || "";
    return stripLeadingNumeric(candidate);
  }

  function extractSeriesNameRaw() {
    const s = txt(document.querySelector(".series"));
    return stripSeriePrefix(s); // e.g. "SOLID LOVE"
  }

  function extractDesc() {
    return txt(document.querySelector(".desc"));
  }

  function extractRrp() {
    const raw = txt(document.querySelector(".sales_price"));
    return normalizePrice(raw);
  }

  /******************************************************************
   * descriptionHtml builder
   ******************************************************************/
  const SKIP_TITLES = new Set(["Product Safety Regulation - GRSP"]);
  const ALLOW_TITLES = new Set(["Details", "Beschrijving", "Care Instructions", "Samenstelling materiaal"]);

  function buildDescriptionHtmlFromDropdowns() {
    const blocks = [...document.querySelectorAll(".dropDownContainer")];
    if (!blocks.length) return "";

    const parts = [];

    for (const b of blocks) {
      const title = txt(b.querySelector(".dropDownTitle"));
      if (!title) continue;

      if (SKIP_TITLES.has(title)) continue;
      if (!ALLOW_TITLES.has(title)) continue;

      const content = b.querySelector(".contentContainer");
      if (!content) continue;

      const ul = content.querySelector("ul");
      let contentHtml = "";

      if (ul) {
        const lis = [...ul.querySelectorAll("li")].map(li => txt(li)).filter(Boolean);
        if (!lis.length) continue;
        contentHtml = `<ul>${lis.map(li => `<li>${escapeHtml(li)}</li>`).join("")}</ul>`;
      } else {
        const t = (content.textContent || "").trim();
        if (!t) continue;
        contentHtml = `<p>${escapeHtml(t).replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>")}</p>`;
      }

      parts.push(`<b>${escapeHtml(title)}</b><br><br>${contentHtml}`);
    }

    return parts.join("<br><br>").trim();
  }

  function toSparkleComment(payloadObj) {
    return `<!--SPARKLE:${JSON.stringify(payloadObj)}-->`;
  }

  /******************************************************************
   * Payload builder
   ******************************************************************/
  function buildSparklePayload() {
    const seriesRaw = extractSeriesNameRaw();        // "SOLID LOVE"
    const seriesTitle = toTitleCaseWords(seriesRaw); // "Solid Love"
    const desc = extractDesc();                      // "sleepshirt short sleeve"
    const colorName = extractColorName();            // "soft pink"

    // "Solid Love Sleepshirt short sleeve soft pink"
    const name = [seriesTitle, desc, colorName].filter(Boolean).join(" ").trim();

    const styleid = extractStyleId();
    const colorKey = extractColorKey();
    const supplierId = (styleid && colorKey) ? `${styleid}-${colorKey}` : "";
    const productCode = supplierId;

    const descriptionHtml = buildDescriptionHtmlFromDropdowns();
    const rrp = extractRrp();
    const compositionUrl = location.href;

    // reference zoals in je Wacoal-voorbeeld
    const reference = " - [ext]";

    return {
      name,
      rrp,
      productCode,
      modelName: seriesRaw,
      descriptionHtml,
      compositionUrl,
      reference,          // ✅ back in
      supplierId
    };
  }

  /******************************************************************
   * Clipboard
   ******************************************************************/
  async function copySparklePayload(reason = "unknown") {
    const payload = buildSparklePayload();

    if (!payload.name || !payload.rrp || !payload.productCode) {
      console.error("❌ Sparkle: payload mist verplichte velden:", payload);
      return;
    }
    if (!payload.descriptionHtml) {
      console.error("❌ Sparkle: descriptionHtml leeg/niet gevonden:", payload);
      return;
    }

    try {
      await navigator.clipboard.writeText(toSparkleComment(payload));
      console.log(`✅ SPARKLE payload gekopieerd (${reason}):`, payload);
    } catch (err) {
      console.error("❌ Fout bij kopiëren:", err);
    }
  }

  /******************************************************************
   * UI
   ******************************************************************/
  function insertButton() {
    const anchor =
      document.querySelector(".desc") ||
      document.querySelector(".series") ||
      document.querySelector(".styleid");

    if (!anchor) return;
    if (document.querySelector(`.${BUTTON_CLASS}`)) return;

    const btn = document.createElement("span");
    btn.className = BUTTON_CLASS;
    btn.textContent = BUTTON_TEXT;

    Object.assign(btn.style, {
      cursor: "pointer",
      marginLeft: "8px",
      fontWeight: "normal",
      fontSize: "14px",
      color: "#0073aa",
      userSelect: "none"
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      copySparklePayload("click");
    });

    anchor.insertAdjacentElement("afterend", btn);
  }

  // Hotkey: Ctrl+Shift+V / Cmd+Shift+V
  document.addEventListener("keydown", (e) => {
    const keyV = (e.key?.toLowerCase() === "v") || (e.code === "KeyV");
    const modOK = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (!modOK || !keyV) return;

    const tag = document.activeElement?.tagName?.toLowerCase();
    const editable =
      tag === "input" ||
      tag === "textarea" ||
      document.activeElement?.isContentEditable;
    if (editable) return;

    e.preventDefault();
    copySparklePayload("hotkey");
  });

  const observer = new MutationObserver(insertButton);
  observer.observe(document.body, { childList: true, subtree: true });

  insertButton();
})();
