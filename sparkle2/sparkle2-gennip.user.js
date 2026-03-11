// ==UserScript==
// @name         Sparkle 2 | Van Gennip
// @version      2.0
// @description  Kopieert een SPARKLE payload naar het klembord (Van Gennip) incl. descriptionHtml + pageUrl + kleur in name.
// @match        https://vangennip.itsperfect.it/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-gennip.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-gennip.user.js
// ==/UserScript==

(function () {
  "use strict";

  const BUTTON_CLASS = "copy-sparkle";
  const BUTTON_TEXT = "✨";

  /******************************************************************
   * Helpers
   ******************************************************************/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

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

  function capitalizeWords(str) {
    return String(str || "").replace(/\w\S*/g, (w) => {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }

  function cleanThema(t) {
    return String(t || "").replace(/^\s*o\s*[-–—]\s*/i, "").trim();
  }

  function toSparkleComment(payloadObj) {
    return `<!--SPARKLE:${JSON.stringify(payloadObj)}-->`;
  }

  function getSpecValueById(id) {
    return txt($(`#${id} .spec__value, #${id} .value`));
  }

  function getPidFromUrl() {
    const m = location.href.match(/p_id=(\d+)/i);
    return m ? m[1] : "";
  }

  /******************************************************************
   * Matrix helpers
   ******************************************************************/
  function getActiveMatrixRow() {
    const matrix = $(".product-matrix.js-product-matrix");
    if (!matrix) return null;
    return $("tbody tr.background-color-hover", matrix) || $("tbody tr", matrix);
  }

  function getColorName() {
    const row = getActiveMatrixRow();
    if (row) {
      return txt($(".item__color_name", row));
    }
    return (
      txt($(".colorName, .color-name")) ||
      getSpecValueById("color_name") ||
      ""
    );
  }

  function getColorCode() {
    const row = getActiveMatrixRow();
    if (row) {
      return txt($(".item__color_number", row));
    }
    return (
      txt($(".colorNumber, .color-number")) ||
      getSpecValueById("color_number") ||
      ""
    );
  }

  function getPrice() {
    let raw =
      txt($(".price__retail span")) ||
      txt($(".product-matrix__price")) ||
      txt($(".salesListPrice span")) ||
      txt($(".product__price .price")) ||
      txt($(".price__now")) ||
      txt($('[itemprop="price"]')) ||
      txt($(".price"));

    return normalizePrice(raw);
  }

  /******************************************************************
   * Page data
   ******************************************************************/
  function getTitleBase() {
    return txt($(".spec__title h1")) || getSpecValueById("item_group") || "";
  }

  function getThema() {
    return cleanThema(getSpecValueById("thema"));
  }

  function getArtikelnummer() {
    return getSpecValueById("item_number") || getSpecValueById("itemNumber") || "";
  }

  function getBrand() {
    return getSpecValueById("brand") || "";
  }

  function buildName() {
    const thema = getThema();
    const baseTitle = getTitleBase();
    const kleur = getColorName();

    const rawTitle = [thema, baseTitle, kleur].filter(Boolean).join(" ").trim();
    return capitalizeWords(rawTitle);
  }

  function buildProductCode() {
    const artikelnummer = getArtikelnummer();
    const colorCode = getColorCode();
    const pid = getPidFromUrl();

    return [artikelnummer, colorCode, pid].filter(Boolean).join("-");
  }

  function findArtikelinformatieHeader() {
    for (const el of $$(".component__header.js-comp-header")) {
      const text = txt(el).toLowerCase();
      if (text === "artikelinformatie") return el;
    }
    return null;
  }

  function buildDescriptionHtml() {
    const header = findArtikelinformatieHeader();
    if (!header) return "";

    const component =
      header.closest(".component") ||
      header.parentElement ||
      document;

    const content =
      $(".component__content", component) ||
      $(".component__body", component) ||
      $(".component__inner", component) ||
      header.nextElementSibling;

    if (!content) return "";

    const nodes = $$("p, li", content);
    if (!nodes.length) {
      const raw = txt(content);
      return raw ? `<p>${escapeHtml(raw)}</p>` : "";
    }

    const parts = nodes
      .map((node) => txt(node))
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`);

    return parts.join("");
  }

  /******************************************************************
   * Payload builder
   ******************************************************************/
  function buildSparklePayload() {
    const name = buildName();
    const rrp = getPrice();
    const productCode = buildProductCode();

    const thema = getThema();
    const artikelnummer = getArtikelnummer();
    const brand = getBrand();
    const pid = getPidFromUrl();

    const supplierId = artikelnummer || pid || productCode;
    const modelName = thema || "";
    const descriptionHtml = buildDescriptionHtml();

    const compositionUrl = location.href;
    const pageUrl = location.href;
    const reference = " - [ext]";

    return {
      name,
      rrp,
      productCode,
      modelName,
      descriptionHtml,
      compositionUrl,
      pageUrl,
      reference,
      supplierId,
      brand
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
      console.warn("⚠️ Sparkle: descriptionHtml is leeg, payload wordt wel gekopieerd:", payload);
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
  function buildButton() {
    const btn = document.createElement("span");
    btn.className = BUTTON_CLASS;
    btn.textContent = ` ${BUTTON_TEXT}`;
    btn.title = "Kopieer SPARKLE payload";

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

    return btn;
  }

  function insertButton() {
    if (document.querySelector(`.${BUTTON_CLASS}`)) return;

    const anchor =
      findArtikelinformatieHeader() ||
      $(".spec__title h1") ||
      $(".price__retail span") ||
      $(".product-matrix.js-product-matrix");

    if (!anchor) return;

    anchor.insertAdjacentElement("afterend", buildButton());
  }

  /******************************************************************
   * Hotkey: Ctrl+Shift+V / Cmd+Shift+V
   ******************************************************************/
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
