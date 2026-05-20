// ==UserScript==
// @name         Sparkle 2 | Chantelle
// @version      1.2
// @description  Kopieert een SPARKLE payload naar het klembord (chantelle-lingerie.my.site.com) incl. optionele descriptionHtml + reference + kleur in name.
// @match        https://chantelle-lingerie.my.site.com/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-chantelle.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-chantelle.user.js
// ==/UserScript==

(function () {
  "use strict";

  const BUTTON_CLASS = "copy-sparkle";
  const BUTTON_TEXT = "✨";

  const txt = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

  function normalizePrice(text) {
    const cleaned = String(text || "").replace(/[^\d,\.]/g, "").trim();
    if (!cleaned) return "";
    return cleaned.replace(",", ".");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function bestModelFromTitle(title) {
    const raw = String(title || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";

    const stop = new Set([
      "wirefree", "wire", "wired",
      "triangle", "bra", "brief", "shorty", "string", "tanga",
      "bodysuit", "body", "top", "dress", "kimono", "robe",
      "push", "up", "plunge", "balconette", "full", "cup",
      "soft", "support", "underwire", "with", "without"
    ]);

    const parts = raw.split(" ").filter(Boolean);
    const modelParts = [];

    for (const p of parts) {
      const clean = p.replace(/[^\p{L}\p{N}\-]/gu, "");
      if (!clean) continue;

      const lc = clean.toLowerCase();
      if (stop.has(lc)) break;

      const looksModelish = clean[0] === clean[0].toUpperCase();
      if (!looksModelish && modelParts.length === 0) continue;
      if (!looksModelish) break;

      modelParts.push(clean);
      if (modelParts.length >= 2) break;
    }

    return modelParts.join(" ").trim() || parts[0] || "";
  }

  function toSparkleComment(payloadObj) {
    return `<!--SPARKLE:${JSON.stringify(payloadObj)}-->`;
  }

  function getSkuFromPage() {
    return txt(document.querySelector(".sku.cc_sku .value.cc_value"));
  }

  function getTitle() {
    return txt(document.querySelector("h4.product_title.cc_product_title"));
  }

  function getRrp() {
    return normalizePrice(txt(document.querySelector("p.price-pvp.cc_price .value.cc_value.cc_price")));
  }

  function getColorNameOnly() {
    const el = document.querySelector(".colorName.cc_color_name .value.cc_value");
    const raw = txt(el);
    if (!raw) return "";

    const parts = raw.split("-").map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.slice(1).join("-").trim();

    return raw.replace(/^\d+\s*/g, "").trim();
  }

  function buildDescriptionHtml() {
    const panel = document.querySelector("#secContentProduct_Info_tabSec");
    if (!panel) return "";

    const p = panel.querySelector("p.secContentProduct_Info") || panel.querySelector("p");
    const raw = (p?.innerText || p?.textContent || "").trim();
    if (!raw) return "";

    return (
      `<p>${escapeHtml(raw)}`
        .replace(/\n{2,}/g, "<br><br>")
        .replace(/\n/g, "<br>") + `</p>`
    ).trim();
  }

  function buildSparklePayload() {
    const supplierId = getSkuFromPage();
    const productCode = supplierId;

    const title = getTitle();
    const colorName = getColorNameOnly();
    const name = [title, colorName].filter(Boolean).join(" ").trim();

    const modelName = bestModelFromTitle(title) || "";
    const rrp = getRrp();
    const descriptionHtml = buildDescriptionHtml();

    const compositionUrl = supplierId
      ? `https://chantelle-lingerie.my.site.com/DefaultStore/ccrz__ProductDetails?sku=${encodeURIComponent(supplierId)}`
      : location.href;

    const reference = " - [ext]";

    const payload = {
      name,
      rrp,
      productCode,
      modelName,
      compositionUrl,
      reference,
      supplierId
    };

    if (descriptionHtml) {
      payload.descriptionHtml = descriptionHtml;
    }

    return payload;
  }

  async function copySparklePayload(reason = "unknown") {
    const payload = buildSparklePayload();

    if (!payload.name || !payload.rrp || !payload.productCode) {
      console.error("❌ Sparkle: payload mist verplichte velden:", payload);
      return;
    }

    try {
      await navigator.clipboard.writeText(toSparkleComment(payload));
      console.log(`✅ SPARKLE payload gekopieerd (${reason}):`, payload);
    } catch (err) {
      console.error("❌ Fout bij kopiëren:", err);
    }
  }

  function insertButton() {
    const anchor =
      document.querySelector("h4.product_title.cc_product_title") ||
      document.querySelector(".colorName.cc_color_name") ||
      document.querySelector(".sku.cc_sku") ||
      document.querySelector("p.price-pvp.cc_price");

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
