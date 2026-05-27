// ==UserScript==
// @name         DDO | SEO Tekst Generator
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      3.0
// @description  Genereert SEO-velden en HTML-content op basis van zoekwoord en longtails.
// @author       Codex
// @match        https://www.dutchdesignersoutlet.com/*
// @match        http://www.dutchdesignersoutlet.com/*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SEO/ddo-seo-gen-v3.0.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SEO/ddo-seo-gen-v3.0.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.openai.com
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// ==/UserScript==

(function () {
  "use strict";

  const SELECTORS = {
    pageTitle: 'input[name="meta[nl][page_title]"]',
    headerTitle: 'input[name="meta[nl][header_title]"]',
    description: 'textarea[name="meta[nl][description]"]',
    keywords: 'input[name="meta[nl][keywords]"]',
    content: 'textarea[name="content"]',
    footerContent: 'textarea[name="meta[nl][footer_content]"], textarea[name="footer_content"], textarea[name="footerContent"], textarea[name="footer"], textarea[name*="footer"]',
    collectionName: 'input[name="name"]',
    productName: 'input[name="name"]',
    supplierPid: 'input[name="supplier_pid"]',
    productBarcodes: 'input[name^="options["][name$="[barcode]"]',
    productDescription: 'textarea[name="description"]',
    showInSidebarYes: 'input[type="radio"][name="show_in_sidebar"][value="1"]',
  };

  const DEFAULT_SETTINGS = {
    model: "gpt-5.2",
    linkSheetCsvUrl: "https://docs.google.com/spreadsheets/d/1eLFtQ6TmwDajQrXRHnmZLAVrb5oSOnWUZoTxohg83Jo/export?format=csv&gid=1530743386",
    waszakjeUrl: "/lingerie/accessoires/ddo-wasnet",
    maxLinkCandidates: 12,
    maxLinksInText: 5,
    pageTitleMinLength: 45,
    contextualLinkTerms: [
      "t-shirt bh",
      "balconette",
      "balconette bh",
      "push up bh",
      "strapless bh",
      "beugel bh",
      "voorgevormde bh",
      "minimizer bh",
      "sport bh",
      "voedingsbh",
      "zwangerschapsbh",
      "bikini",
      "badpak",
      "tankini",
      "kleur",
      "kleuren",
      "kleur behouden",
      "kleur mooi houden",
      "wassen",
      "wasadvies",
      "huidtint",
      "huidskleur",
      "badmode kleur",
      "welke kleur past bij mij",
    ],
    pageTitleMaxLength: 60,
    metaDescriptionMaxLength: 155,
    introWordTarget: 80,
    paragraphWordMin: 60,
    paragraphWordMax: 75,
  };

  let lastSeoState = {
    request: null,
    result: null,
  };

  function addStyles() {
    const css = `
      #seo-writer-opener {
        position: fixed;
        right: 113px;
        bottom: 16px;
        z-index: 2147483646;
        width: 42px;
        height: 39px;
        background: #ffffff;
        color: #e5e7eb;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 999px;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.25);
        font: 700 13px/1 Arial, sans-serif;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        user-select: none;
        padding: 0;
      }

      #seo-writer-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(11, 18, 32, 0.8);
        display: none;
      }

      #seo-writer-panel {
        position: absolute;
        right: 24px;
        bottom: 24px;
        width: 760px;
        max-width: calc(100vw - 48px);
        max-height: calc(100vh - 48px);
        overflow: auto;
        background: #ffffff;
        color: #1f2933;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
        font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }

      .seo-writer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 14px 14px 0;
        background: #ffffff;
        color: #0f172a;
        font-weight: 700;
      }

      .seo-writer-header button,
      .seo-writer-actions button {
        cursor: pointer;
      }

      .seo-writer-close,
      .seo-writer-actions button {
        border: 1px solid #dddddd;
        background: #fafafa;
        border-radius: 8px;
        padding: 8px 10px;
      }

      .seo-writer-close {
        line-height: 1;
      }

      .seo-writer-body {
        padding: 14px;
      }

      .seo-writer-body label {
        display: block;
        margin: 0 0 6px;
        font-weight: 700;
      }

      .seo-writer-body textarea,
      .seo-writer-body input,
      .seo-writer-body select {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #b7c2cf;
        padding: 8px;
        font: 13px/1.35 Arial, sans-serif;
      }

      .seo-writer-body textarea {
        min-height: 78px;
        resize: vertical;
      }

      .seo-writer-help {
        margin: 6px 0 10px;
        color: #52616f;
        font-size: 12px;
      }

      #seo-writer-analysis {
        display: none;
        margin: 0 0 12px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #f8fafc;
      }

      #seo-writer-analysis[open] {
        display: block;
      }

      #seo-writer-analysis summary {
        cursor: pointer;
        padding: 9px 10px;
        color: #0f172a;
        font-weight: 700;
      }

      .seo-analysis-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        padding: 0 10px 10px;
      }

      .seo-analysis-item {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #ffffff;
        padding: 8px;
        min-width: 0;
      }

      .seo-analysis-label {
        color: #64748b;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .seo-analysis-value {
        margin-top: 3px;
        color: #0f172a;
        font-size: 13px;
        word-break: break-word;
      }

      .seo-analysis-wide {
        grid-column: 1 / -1;
      }

      .seo-analysis-fix {
        margin-left: 6px;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        background: #ffffff;
        color: #0f172a;
        cursor: pointer;
        padding: 2px 6px;
        font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }

      .seo-analysis-fix:disabled {
        opacity: .6;
        cursor: wait;
      }

      .seo-density-tabs {
        display: flex;
        gap: 6px;
        margin: 0 0 8px;
      }

      .seo-density-tab {
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        background: #ffffff;
        padding: 4px 8px;
        cursor: pointer;
        font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }

      .seo-density-tab.is-active {
        background: #0f172a;
        color: #ffffff;
        border-color: #0f172a;
      }

      .seo-density-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .seo-density-table th,
      .seo-density-table td {
        border-top: 1px solid #e5e7eb;
        padding: 5px 4px;
        text-align: left;
      }

      .seo-link-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .seo-link-table th,
      .seo-link-table td {
        border-top: 1px solid #e5e7eb;
        padding: 5px 4px;
        text-align: left;
        vertical-align: top;
      }

      .seo-settings {
        margin-top: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #f8fafc;
      }

      .seo-settings summary {
        cursor: pointer;
        padding: 9px 10px;
        font-weight: 700;
      }

      .seo-settings-body {
        padding: 0 10px 10px;
      }

      .seo-analysis-list {
        margin: 4px 0 0;
        padding-left: 16px;
      }

      .seo-writer-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 8px;
      }

      .seo-writer-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }

      .seo-writer-actions button {
        color: #0f172a;
      }

      .seo-writer-actions button.secondary {
        background: #ffffff;
      }

      .seo-writer-status {
        margin-top: 10px;
        min-height: 18px;
        color: #52616f;
      }
    `;

    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createPanel() {
    if (document.getElementById("seo-writer-overlay")) return;

    const opener = document.createElement("button");
    opener.id = "seo-writer-opener";
    opener.type = "button";
    opener.title = "SEO tekst generator";
    opener.textContent = "SEO";
    document.body.appendChild(opener);

    const overlay = document.createElement("div");
    overlay.id = "seo-writer-overlay";
    overlay.innerHTML = `
      <div id="seo-writer-panel">
        <div class="seo-writer-header">
          <span>SEO tekst generator${getPageContextLabel() ? ` voor <em>${escapeHtml(getPageContextLabel())}</em>` : ""}</span>
          <button type="button" class="seo-writer-close" title="Sluiten">x</button>
        </div>
        <div class="seo-writer-body">
          <details id="seo-writer-analysis">
            <summary>Analyse</summary>
            <div id="seo-writer-analysis-content"></div>
          </details>
          <label for="seo-writer-input">Zoekwoord | longtail(s)</label>
          <textarea id="seo-writer-input" placeholder="Voorbeeld: cupmaat 80C | bh maat 80C, balconette bh 80C, lingerie 80C">${escapeHtml(getKeywordInputFromMeta())}</textarea>
          <label for="seo-writer-tone">Extra instructies</label>
          <input id="seo-writer-tone" type="text" placeholder="Bijv. luchtiger, meer advies, specifieker voor badmode">
          <details class="seo-settings">
            <summary>Instellingen</summary>
            <div class="seo-settings-body">
              <div class="seo-writer-row">
                <div>
                  <label for="seo-writer-page-type">Paginatype</label>
                  <select id="seo-writer-page-type">
                    <option value="categoriepagina" ${getDetectedPageType() === "categoriepagina" ? "selected" : ""}>Categoriepagina</option>
                    <option value="hubpagina" ${getDetectedPageType() === "hubpagina" ? "selected" : ""}>Hubpagina</option>
                    <option value="landingspagina">Landingspagina</option>
                    <option value="blog" ${getDetectedPageType() === "blog" ? "selected" : ""}>Blog</option>
                    <option value="merkpagina" ${getDetectedPageType() === "merkpagina" ? "selected" : ""}>Merkpagina</option>
                    <option value="collectie" ${getDetectedPageType() === "collectie" ? "selected" : ""}>Collectie</option>
                    <option value="product" ${getDetectedPageType() === "product" ? "selected" : ""}>Producttekst</option>
                  </select>
                </div>
                <div>
                  <label for="seo-writer-model">Model</label>
                  <input id="seo-writer-model" type="text" value="${escapeAttribute(getStoredValue("seoWriterModel", DEFAULT_SETTINGS.model))}">
                </div>
              </div>
              <label for="seo-writer-url">URL of slug</label>
              <input id="seo-writer-url" type="text" placeholder="/bh/cupmaat-80c" value="${escapeAttribute(getPageSlug())}">
              <label for="seo-writer-links">Interne links</label>
              <textarea id="seo-writer-links" placeholder="Een per regel: https://... | beschrijvende anchor"></textarea>
              <label for="seo-writer-api-key">OpenAI API key</label>
              <input id="seo-writer-api-key" type="password" placeholder="sk-..." value="${escapeAttribute(getStoredValue("seoWriterApiKey", ""))}">
            </div>
          </details>
          <div class="seo-writer-actions">
            <button type="button" id="seo-writer-fill">Genereer met API</button>
            <button type="button" id="seo-writer-analyze-current" class="secondary">Analyseer huidige tekst</button>
            <button type="button" id="seo-writer-preview" class="secondary">Preview</button>
          </div>
          <div class="seo-writer-status" id="seo-writer-status"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    opener.addEventListener("click", () => toggleOverlay(true));
    overlay.querySelector(".seo-writer-close").addEventListener("click", () => toggleOverlay(false));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) toggleOverlay(false);
    });

    document.getElementById("seo-writer-fill").addEventListener("click", async () => {
      const result = await buildSeoTextFromApi();
      if (!result) return;
      fillCmsFields(result);
    });

    document.getElementById("seo-writer-preview").addEventListener("click", () => {
      const result = buildSeoTextFromInput();
      if (!result) return;
      renderSeoAnalysis(result);
      showPreview(result);
    });

    document.getElementById("seo-writer-analyze-current").addEventListener("click", () => {
      const result = getCurrentCmsResultForAnalysis();
      if (!result) return;
      renderSeoAnalysis(result);
    });

    document.getElementById("seo-writer-input").addEventListener("input", (event) => {
      normalizeVisibleSeparator(event.target);
    });

    document.getElementById("seo-writer-analysis-content").addEventListener("click", async (event) => {
      const tab = event.target.closest(".seo-density-tab");
      if (tab) {
        setDensityTab(tab.dataset.density);
        return;
      }

      const button = event.target.closest(".seo-analysis-fix");
      if (!button) return;
      await repairSeoIssue(button.dataset.issue);
    });
  }

  function toggleOverlay(force) {
    const overlay = document.getElementById("seo-writer-overlay");
    if (!overlay) return;

    const willOpen = typeof force === "boolean"
      ? force
      : overlay.style.display === "none" || overlay.style.display === "";

    overlay.style.display = willOpen ? "block" : "none";
  }

  async function buildSeoTextFromApi() {
    const status = document.getElementById("seo-writer-status");
    const request = getSeoRequestInput();
    if (!request) return null;

    saveApiSettings(request);
    lastSeoState.request = request;
    status.textContent = "Linkdatabase wordt opgehaald...";

    try {
      request.linkCandidates = await getRankedLinkCandidates(request);
      status.textContent = request.linkCandidates.length
        ? `Tekst wordt gegenereerd met ${request.linkCandidates.length} linkkandidaten op basis van zoekwoord en longtails...`
        : "Tekst wordt gegenereerd zonder automatische linkkandidaten...";
      const apiResult = await callOpenAiSeoGenerator(request);
      status.textContent = "API-tekst ontvangen; velden worden ingevuld.";
      return normalizeApiResult(apiResult, request);
    } catch (error) {
      status.textContent = `API-fout: ${error.message}`;
      return null;
    }
  }

  function buildSeoTextFromInput() {
    const status = document.getElementById("seo-writer-status");
    const request = getSeoRequestInput();

    if (!request) return null;

    status.textContent = "";
    const result = generateSeoText(request.keyword, request.longtails, request.extraInstruction);
    lastSeoState.request = request;
    return result;
  }

  function getSeoRequestInput() {
    const status = document.getElementById("seo-writer-status");
    const inputField = document.getElementById("seo-writer-input");
    if (inputField && !inputField.value.trim()) {
      inputField.value = getKeywordInputFromMeta();
    }

    const rawInput = inputField.value.trim();
    const parsed = parseKeywordInput(rawInput);

    if (!parsed.keyword) {
      status.textContent = "Vul minimaal een hoofdzoekwoord in.";
      return null;
    }

    return {
      keyword: parsed.keyword,
      longtails: parsed.longtails,
      pageType: document.getElementById("seo-writer-page-type").value,
      url: document.getElementById("seo-writer-url").value.trim(),
      collectionInfo: getCollectionInfo(),
      productInfo: getProductInfo(),
      internalLinks: document.getElementById("seo-writer-links").value.trim(),
      extraInstruction: document.getElementById("seo-writer-tone").value.trim(),
      apiKey: document.getElementById("seo-writer-api-key").value.trim(),
      model: document.getElementById("seo-writer-model").value.trim() || DEFAULT_SETTINGS.model,
    };
  }

  function getPageContextLabel() {
    const product = getProductInfo();
    if (product.name && getDetectedPageType() === "product") {
      return product.name;
    }

    const collection = getCollectionInfo();
    if (collection.brandName && collection.collectionName) {
      return `${collection.brandName} ${collection.collectionName}`;
    }

    return getPageSlug();
  }

  function getPageSlug() {
    const readonlyInputs = Array.from(document.querySelectorAll('input[readonly], input[readonly="readonly"]'));
    const slugField = readonlyInputs.find((field) => {
      const value = cleanWhitespace(field.value);
      return value.startsWith("/") && !value.includes(" ");
    });

    return slugField ? cleanWhitespace(slugField.value) : "";
  }

  function getKeywordInputFromMeta() {
    const keywords = getFieldValue(SELECTORS.keywords);
    const items = keywords
      .split(/[,;\n]/)
      .map((item) => cleanWhitespace(item))
      .filter(Boolean);

    if (!items.length) {
      const collection = getCollectionInfo();
      if (collection.brandName && collection.collectionName && getDetectedPageType() === "collectie") {
        const keyword = `${collection.brandName} ${collection.collectionName}`;
        const longtails = [
          `${collection.brandName} ${collection.collectionName} collectie`,
          `${collection.brandName} ${collection.collectionName} sale`,
          `${collection.brandName} ${collection.collectionName} kopen`,
        ];
        return `${keyword} | ${longtails.join(", ")}`;
      }

      const product = getProductInfo();
      if (product.name && getDetectedPageType() === "product") {
        const longtails = [
          product.supplierPid,
          product.eans[0],
          `${product.name} kopen`,
          `${product.name} sale`,
        ].filter(Boolean);
        return longtails.length ? `${product.name} | ${longtails.join(", ")}` : product.name;
      }

      return "";
    }
    return items.length === 1 ? items[0] : `${items[0]} | ${items.slice(1).join(", ")}`;
  }

  function getDetectedPageType() {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section") || "";
    const action = params.get("action") || "";
    if (section === "products" && action === "edit") return "product";
    if (section === "brands" && action === "modeledit") return "collectie";
    if (section === "news") return "blog";
    if (section === "brands") return "merkpagina";
    if (section === "categories" && isHubSlug(getPageSlug())) return "hubpagina";
    if (section === "categories") return "categoriepagina";
    return "categoriepagina";
  }

  function getCollectionInfo() {
    const collectionField = document.querySelector(SELECTORS.collectionName);
    const activeCrumb = document.querySelector(".header_item_element a.active");
    const collectionName = cleanWhitespace(collectionField?.value || collectionField?.getAttribute("value") || activeCrumb?.textContent || "");
    const brandCrumb = document.querySelector('.header_item_element a[href*="section=brands"][href*="action=edit"]');
    const brandName = cleanWhitespace(brandCrumb?.textContent || "");
    const brandHref = brandCrumb ? brandCrumb.getAttribute("href") || "" : "";

    return { brandName, collectionName, brandHref };
  }

  function getProductInfo() {
    const nameField = document.querySelector(SELECTORS.productName);
    const supplierField = document.querySelector(SELECTORS.supplierPid);
    const descriptionField = getProductDescriptionField();
    const supplierDescriptionHtml = descriptionField ? getEditorHtml(descriptionField) || descriptionField.value || "" : "";
    const eans = Array.from(document.querySelectorAll(SELECTORS.productBarcodes))
      .map((field) => cleanWhitespace(field.value || field.getAttribute("value") || ""))
      .filter((value) => /^\d{8,14}$/.test(value));

    return {
      name: cleanWhitespace(nameField?.value || nameField?.getAttribute("value") || ""),
      supplierPid: cleanWhitespace(supplierField?.value || supplierField?.getAttribute("value") || ""),
      eans: Array.from(new Set(eans)).slice(0, 5),
      supplierDescriptionHtml,
      supplierDescriptionText: htmlToPlainText(supplierDescriptionHtml),
      compositionLines: extractCompositionLines(supplierDescriptionHtml),
    };
  }

  function getProductDescriptionField() {
    return document.querySelector(SELECTORS.productDescription) || findTextareaByControlLabel("Description");
  }

  function extractCompositionLines(html) {
    const container = document.createElement("div");
    container.innerHTML = String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n");
    const source = container.textContent || "";
    return source
      .split(/\n+/)
      .map((line) => cleanWhitespace(line))
      .filter((line) => /\b\d{1,3}\s*%\b/.test(line))
      .slice(0, 8);
  }

  function isHubSlug(slug) {
    const clean = normalizeSlug(slug);
    return /\/(kleur|kleuren|maat|maten|model|modellen|type|types|soort|soorten)$/.test(clean);
  }

  function saveApiSettings(request) {
    setStoredValue("seoWriterApiKey", request.apiKey);
    setStoredValue("seoWriterModel", request.model);
  }

  async function callOpenAiSeoGenerator(request) {
    if (!request.apiKey) {
      throw new Error("Vul eerst je OpenAI API key in.");
    }

    const payload = {
      model: request.model,
      instructions: buildApiInstructions(),
      input: buildApiInput(request),
      text: {
        format: {
          type: "json_schema",
          name: "seo_text_result",
          strict: true,
          schema: getSeoJsonSchema(),
        },
      },
    };

    if (request.pageType === "collectie" || request.pageType === "product") {
      payload.tools = [{ type: "web_search" }];
      payload.tool_choice = "auto";
    }

    const response = await gmRequest({
      method: "POST",
      url: "https://api.openai.com/v1/responses",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      data: JSON.stringify(payload),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(extractApiError(response.responseText) || `HTTP ${response.status}`);
    }

    const data = JSON.parse(response.responseText);
    const text = data.output_text || extractOutputText(data);
    if (!text) throw new Error("Geen tekst in API-response gevonden.");

    return JSON.parse(text);
  }

  async function repairSeoIssue(issueCode) {
    const status = document.getElementById("seo-writer-status");
    const button = document.querySelector(`.seo-analysis-fix[data-issue="${CSS.escape(issueCode)}"]`);
    const baseRequest = lastSeoState.request || getSeoRequestInput();
    const currentResult = lastSeoState.result;

    if (!baseRequest || !currentResult) {
      if (status) status.textContent = "Geen tekst beschikbaar om te herstellen.";
      return;
    }

    if (!baseRequest.apiKey) {
      if (status) status.textContent = "Vul eerst je OpenAI API key in.";
      return;
    }

    if (button) button.disabled = true;
    if (status) status.textContent = `Herstel wordt uitgevoerd: ${getIssueLabel(issueCode)}...`;

    try {
      if (!baseRequest.linkCandidates || !baseRequest.linkCandidates.length) {
        baseRequest.linkCandidates = await getRankedLinkCandidates(baseRequest);
      }

      const apiResult = await callOpenAiRepair(baseRequest, currentResult, issueCode);
      const repaired = normalizeApiResult(apiResult, baseRequest);
      fillCmsFields(repaired);
      if (status) status.textContent = `Herstel afgerond: ${getIssueLabel(issueCode)}.`;
    } catch (error) {
      if (status) status.textContent = `Herstel mislukt: ${error.message}`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function callOpenAiRepair(request, currentResult, issueCode) {
    const payload = {
      model: request.model,
      instructions: [
        buildApiInstructions(),
        "Je herziet een bestaande SEO-output. Los alleen het genoemde issue op, maar behoud goede onderdelen.",
        "Geef opnieuw uitsluitend geldige JSON volgens het schema.",
      ].join("\n"),
      input: buildRepairInput(request, currentResult, issueCode),
      text: {
        format: {
          type: "json_schema",
          name: "seo_text_result",
          strict: true,
          schema: getSeoJsonSchema(),
        },
      },
    };

    if (request.pageType === "collectie" || request.pageType === "product") {
      payload.tools = [{ type: "web_search" }];
      payload.tool_choice = "auto";
    }

    const response = await gmRequest({
      method: "POST",
      url: "https://api.openai.com/v1/responses",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      data: JSON.stringify(payload),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(extractApiError(response.responseText) || `HTTP ${response.status}`);
    }

    const data = JSON.parse(response.responseText);
    const text = data.output_text || extractOutputText(data);
    if (!text) throw new Error("Geen tekst in API-response gevonden.");

    return JSON.parse(text);
  }

  function buildRepairInput(request, currentResult, issueCode) {
    return [
      `Te herstellen issue: ${getIssueLabel(issueCode)}`,
      `Specifieke opdracht: ${getRepairInstruction(issueCode)}`,
      "",
      "Originele aanvraag:",
      buildApiInput(request),
      "",
      "Huidige output als JSON:",
      JSON.stringify({
        page_title: currentResult.pageTitle,
        header_title: currentResult.headerTitle,
        meta_description: currentResult.metaDescription,
        meta_keywords: currentResult.keywords,
        intro_html: currentResult.introHtml,
        body_html: currentResult.bodyHtml,
      }, null, 2),
    ].join("\n");
  }

  function getIssueLabel(issueCode) {
    const labels = {
      keyword_density_low: "keyword density verhogen",
      keyword_density_high: "keyword density verlagen",
      long_sentence: "langste zin inkorten",
      heading_count: "meer structuur met H2-koppen",
      text_too_short: "tekst verdiepen",
      internal_links: "meer relevante interne links",
      category_link: "categoriepagina-link toevoegen",
      brand_link: "merkpagina-link toevoegen",
      missed_link_opportunities: "gemiste linkkansen toevoegen",
      forbidden_formulas: "verboden GPT-formules herschrijven",
      repeated_starters: "herhalende zinsstarters herschrijven",
      page_title_length: "page title lengte verbeteren",
      meta_description_length: "meta description lengte verbeteren",
      keyword_first_paragraph: "hoofdzoekwoord in eerste alinea",
      keyword_last_paragraph: "hoofdzoekwoord in laatste alinea",
    };
    return labels[issueCode] || issueCode;
  }

  function getRepairInstruction(issueCode) {
    const instructions = {
      keyword_density_low: "Verwerk het hoofdzoekwoord natuurlijk iets vaker, vooral in body_html. Forceer niets.",
      keyword_density_high: "Verminder herhaling van het hoofdzoekwoord en gebruik synoniemen.",
      long_sentence: "Kort de langste zin of lange zinnen in. Houd de inhoud overeind.",
      heading_count: "Voeg waar logisch extra H2-structuur toe in body_html.",
      text_too_short: "Maak de tekst inhoudelijk rijker met alinea's van ongeveer 60-75 woorden.",
      internal_links: "Voeg meer relevante interne links toe uit de beschikbare kandidaten, zonder linkclusters.",
      category_link: "Voeg een relevante categoriepagina-link toe uit de kandidaten, liefst bij een genoemd producttype.",
      brand_link: "Voeg een relevante merkpagina-link toe uit de kandidaten, alleen bij een genoemd of passend merk.",
      missed_link_opportunities: "Voeg gemiste linkkansen toe waar ze natuurlijk passen. Gebruik vooral links waarvan de anchor of context al in de tekst voorkomt.",
      forbidden_formulas: "Herschrijf generieke GPT-formules naar natuurlijke, specifieke zinnen.",
      repeated_starters: "Varieer zinsstarters en herschrijf herhalingen zoals meerdere zinnen die met 'Handig' beginnen.",
      page_title_length: `Maak page_title natuurlijker en sterker, tussen ${DEFAULT_SETTINGS.pageTitleMinLength}-${DEFAULT_SETTINGS.pageTitleMaxLength} tekens, zonder dubbele punt.`,
      meta_description_length: `Breng meta_description terug tot maximaal ${DEFAULT_SETTINGS.metaDescriptionMaxLength} tekens, zonder dubbele punt.`,
      keyword_first_paragraph: "Zorg dat het hoofdzoekwoord natuurlijk in de eerste alinea staat, liefst in de eerste zin.",
      keyword_last_paragraph: "Zorg dat het hoofdzoekwoord natuurlijk in de laatste alinea staat.",
    };
    return instructions[issueCode] || "Herstel dit issue gericht en behoud de rest zoveel mogelijk.";
  }

  function buildApiInstructions() {
    return [
      "Je schrijft Nederlandse SEO-teksten voor lingerie en badmode.",
      "Doelgroep: vrouwen van 30 jaar en ouder.",
      "Schrijf informeel, luchtig, realistisch, behulpzaam en informerend.",
      "Subtiele humor mag, maar voorkom cabaret en overdreven marketing.",
      "Vermijd generieke AI-taal en verboden patronen zoals: 'in de wereld van', 'ontdek de perfecte', 'of je nu op zoek bent naar x of y', 'in de stijl van'.",
      "Schrijf actief. Vermijd waar mogelijk: worden, zullen, kunnen, gaan.",
      "Gebruik korte zinnen. Richtlijn: maximaal 15 woorden per zin.",
      `Maak alinea's meestal ${DEFAULT_SETTINGS.paragraphWordMin}-${DEFAULT_SETTINGS.paragraphWordMax} woorden en behandel een onderwerp per alinea.`,
      "Schrijf liever iets inhoudelijker dan te kort. Rond 70 woorden per alinea is prima als de uitleg daardoor beter wordt.",
      "De H1 bevat het hoofdzoekwoord.",
      "Gebruik het hoofdzoekwoord in maximaal 70% van de H2-koppen. Niet elk kopje hoeft het zoekwoord te bevatten.",
      "Varieer H2-koppen met synoniemen, deelonderwerpen en natuurlijke vragen. Voorkom SEO-overkill in koppen.",
      "Gebruik het hoofdzoekwoord in de eerste alinea, bij voorkeur in de eerste zin.",
      "Gebruik het hoofdzoekwoord in de laatste alinea.",
      "Mik op 1-2% zoekwoorddichtheid, ongeveer 2% als dat natuurlijk blijft.",
      "Gebruik synoniemen, longtails, semantiek en semantische zoekwoorden.",
      "Buit onzekerheden niet uit. Praat respectvol over lichamen, maten en pasvorm.",
      "Page titles zijn natuurlijk, overtuigend en zonder merknaam achteraan.",
      `Page titles mogen niet te kort zijn. Mik op ${DEFAULT_SETTINGS.pageTitleMinLength}-${DEFAULT_SETTINGS.pageTitleMaxLength} tekens als dat natuurlijk kan.`,
      "Voeg in page titles gerust overtuiging toe rond keuze, pasvorm, comfort, sale of scherpe prijzen.",
      "Voorbeeldrichting: Blauwe bh in elke tint en pasvorm voor super scherpe prijzen.",
      "Gebruik NOOIT een dubbele punt in page_title, header_title, meta_description of H2-koppen.",
      "Gebruik geen dubbele punt als stijlmiddel. Herformuleer met gewone Nederlandse zinnen.",
      "Meta description is maximaal 155 tekens.",
      "Intro HTML bevat precies een p-tag met style text-align: justify.",
      "Body HTML bevat h2-tags met style text-align: center en p-tags met style text-align: justify.",
      `Gebruik maximaal ${DEFAULT_SETTINGS.maxLinksInText} interne links in de tekst.`,
      "Gebruik bij categoriepagina's en merkpagina's bij voorkeur 3-5 relevante interne links als de kandidaten sterk genoeg zijn.",
      "Verwerk waar mogelijk minstens een relevante categoriepagina en minstens een relevante merkpagina.",
      "Bij blogs geldt: kies liever een blog dat in dezelfde subhoek blijft dan een algemeen blog. Voor een push up bh tekst is een blog over de beste push up bh veel beter dan een algemeen blog over soorten bh's.",
      "Gebruik een bloglink narratief en nuttig. Voorbeeld: Onze lingerie expert Monique heeft uitgezocht <em><a href=\"/slug\">wat de beste push up bh is</a></em>.",
      "Voor hubpagina's zoals /kleur, /maat of /model schrijf je een overzichtstekst. Forceer dan geen harde keyword density op een enkel exact zoekwoord.",
      "Een hubpagina moet vooral helpen kiezen, context geven en logisch linken naar onderliggende categorieën.",
      "Bij een kleur-hubpagina bespreek je bijvoorbeeld basiskleuren, opvallende kleuren, huidskleur, kleding, onderhoud en doorklikken naar specifieke kleurcategorieën.",
      "Bij hubpagina's mogen veel interne links naar onderliggende categorieën, mits ze natuurlijk verdeeld zijn en niet als linklijst voelen.",
      "Voor collectiepagina's gebruik je als hoofdzoekwoord de combinatie merknaam + collectienaam of modelnummer.",
      "Voor collectiepagina's zoek je actuele informatie op internet over merk + collectie/model. Gebruik gevonden informatie voorzichtig en verzin geen productdetails als die niet duidelijk te vinden zijn.",
      "Als er weinig openbare informatie over de collectie is, schrijf dan een realistische tekst op basis van merkidentiteit, type assortiment, styling, pasvorm/gebruik en koopintentie. Zeg niet dat je niets kon vinden.",
      "Voor collectiepagina's moeten merknaam en collectienaam in page_title, header_title, meta_description en meta_keywords voorkomen.",
      "Voor collectiepagina's moet body_html of intro_html minimaal een interne link naar de bovenliggende merkpagina bevatten als die kandidaat beschikbaar is.",
      "Voor collectiepagina's mogen merkgerelateerde pagina's uit de linkdatabase extra prioriteit krijgen, maar link alleen als de context logisch blijft.",
      "Voor productpagina's schrijf je een korte, krachtige producttekst. Denk aan 45-90 woorden lopende tekst, tenzij extra instructies anders vragen.",
      "Voor productpagina's gebruik je productnaam, supplier ID, EAN en bestaande leverancierstekst als zoekreferenties. De bestaande description-content weegt zwaar.",
      "Voor productpagina's zijn supplier ID's uitsluitend bedoeld om het juiste item te vinden. Gebruik supplier ID's nooit als zoekwoord en noem ze niet in de tekst, meta description of meta keywords.",
      "Voor productpagina's zijn EAN-codes uitsluitend bedoeld om het juiste item te vinden. Gebruik EAN-codes nooit als zoekwoord en noem ze niet in de tekst, meta description of meta keywords.",
      "Voor productpagina's mag body_html leeg blijven. Gebruik intro_html voor de complete producttekst.",
      "Voor productpagina's bestaat intro_html uit een korte p-tag met style text-align: justify en daaronder altijd een productsamenstellingblok.",
      "Het productsamenstellingblok gebruikt exact deze kop: <strong>Productsamenstelling</strong>.",
      "Neem productsamenstelling feitelijk over uit leverancierstekst of betrouwbare productinformatie. Verzin nooit percentages, materialen of herkomst.",
      "Als productsamenstelling betrouwbaar beschikbaar is, zet die onder de kop in een <ul><li>...</li></ul>.",
      "Als herkomst zoals China, Thailand of Nederland betrouwbaar beschikbaar is, mag die in dezelfde opsomming worden opgenomen.",
      "Als productsamenstelling echt niet betrouwbaar beschikbaar is, zet direct onder de kop: <i>Niet opgegeven door fabrikant</i>.",
      "Voor productpagina's schrijf je concreet en verkoopgericht, zonder lange SEO-uitleg, zonder H2-koppen en zonder blogverwijzingen.",
      "Voor productpagina's gebruik je geen interne links.",
      "Voor productpagina's blijf je volledig bij het product zelf. Schrijf geen uitstapjes zoals 'liever eerst het merk bekijken' en verwijs niet naar merk-, categorie- of blogpagina's.",
      "Voor productpagina's benoem je waar mogelijk de collectie of lijn waar het item bij hoort en het specifieke model.",
      "Voor productpagina's mag je de kleur benoemen als die relevant is, maar gebruik geen kleurcode als zoekwoord en noem de kleurcode niet in de tekst.",
      "Voor productpagina's mogen twee korte alinea's als dat natuurlijker leest. Kort en compleet is belangrijker dan geforceerd een alinea.",
      "Voor productpagina's mogen meta title, meta description en keywords wel worden ingevuld als de velden bestaan.",
      "Als een H2 of alinea een duidelijk producttype noemt, zoals push up bh, T-shirt bh, balconette bh of strapless bh, link dan naar de passende categoriepagina als die kandidaat beschikbaar is.",
      "Als een kop bijvoorbeeld 'blauwe push up bh en andere vormen' heet en de alinea push up bh inhoudelijk bespreekt, verdient die eerste natuurlijke vermelding een interne link naar de push up bh categorie.",
      "Overweeg een bloglink als die echt iets toevoegt, maar forceer geen bloglink in elke tekst.",
      "Varieer in blogverwijzingen en invalshoeken. Kies niet steeds automatisch voor een algemeen blog over soorten bh's als een specifieker blog over kleur, onderhoud, wassen, huidtint, styling of badmode beter aansluit.",
      "Maak kleurpagina's onderling onderscheidend. Varieer de invalshoek tussen styling, huidtint, onder kleding dragen, materiaal, onderhoud, modellen, merken, seizoen en draagmoment.",
      "Gebruik het woord ton-sur-ton niet.",
      "Werk minder herhalend in zinsstarters. Begin niet meerdere voordeelzinnen met hetzelfde woord zoals 'Handig'. Gebruik zo'n starter hooguit een keer per tekst.",
      "Gebruik interne links alleen als ze inhoudelijk echt relevant zijn.",
      "Gebruik dezelfde URL maximaal een keer.",
      "Gebruik geen interne link naar de huidige pagina.",
      "Gebruik alleen beschrijvende anchors. Gebruik nooit 'klik hier', 'lees meer' of 'deze pagina'.",
      "Als de linkkandidaten niet relevant genoeg zijn, gebruik dan minder links of geen links.",
      "Plaats interne links bij voorkeur in body_html, niet in intro_html.",
      "Maak links als gewone HTML: <a href=\"/slug\">beschrijvende anchor</a>.",
      "Als het woord waszakje natuurlijk in de tekst voorkomt, link dan de eerste vermelding naar /lingerie/accessoires/ddo-wasnet. Voeg het woord waszakje nooit speciaal toe om deze link te kunnen plaatsen.",
      "Verwijzingen naar blogs moeten natuurlijk en narratief klinken, niet als een losse SEO-verwijzing.",
      "Gebruik liever zinnen zoals: Lees ons blog over <em><a href=\"/slug\">welke soorten bh's er zijn</a></em> en ontdek welke opties bij jouw outfit en borstvorm passen.",
      "Vermijd stijve blogformules zoals 'In het blog met advies over ...', 'ons blog met advies over ...', 'in ons blog met advies over ...' of 'in ons blog over ... lees je snel'.",
      "Gebruik 'advies over' bijna nooit vlak voor een bloganchor. Schrijf menselijker, bijvoorbeeld: Wil je dat de kleur langer mooi blijft, bekijk dan <em><a href=\"/slug\">de blogtitel</a></em>.",
      "Begin blogverwijzingen liever met een werkwoord of concrete aanleiding, zoals 'Lees', 'Bekijk', 'Twijfel je tussen modellen, lees dan', of 'Wil je meer houvast, bekijk dan'.",
      "Verwerk de blogtitel of anchor als natuurlijk onderdeel van de zin en zet de gelinkte bloganchor eventueel tussen <em>...</em>.",
      "Gebruik nooit markdown-asterisks voor cursieve tekst. Gebruik uitsluitend <em>...</em> als iets schuin moet staan.",
      "De enige uitzondering op asterisks is de exacte dynamische verzendwaarde: €**ORDER_PRICE_FREE_SHIPPING**. Laat deze exact zo staan, inclusief dubbele asterisks.",
      "Als klantenservice relevant ter sprake komt, link dan naar <a href=\"/klantenservice/contact\">klantenservice</a>.",
      "Als verzending relevant ter sprake komt, mag je benoemen: verzendkostenvrij vanaf €**ORDER_PRICE_FREE_SHIPPING**.",
      "Noem een pasafspraak met Monique alleen bij duidelijke twijfel over maat, pasvorm of persoonlijke fitting. Gebruik dit niet als standaard afsluiter.",
      "Als passen of maatadvies relevant ter sprake komt, mag je benoemen dat een pasafspraak kan met lingerie expert Monique, badmode expert Monique of lingerie én badmode expert Monique via <a href=\"/klantenservice/pas-afspraak\">een pasafspraak</a>. Kies de expertise op basis van de pagina-inhoud.",
      "Gebruik op categoriepagina's en merkpagina's alleen een bloglink als er een echt passende blogkandidaat beschikbaar is.",
      "Benoemde merken mogen gelinkt worden als de linkkandidaat precies bij dat merk past.",
      "Benoemde bh-modellen en producttypen mogen gelinkt worden als er een exacte of zeer passende kandidaat is, bijvoorbeeld T-shirt bh, balconette bh, push up bh of strapless bh.",
      "Voorkom linkclusters, maar wees niet te zuinig. Plaats liever niet meer dan twee interne links in een korte alinea, tenzij drie merken of producttypes inhoudelijk echt naast elkaar worden vergeleken.",
      "Geef uitsluitend geldige JSON terug volgens het schema.",
    ].join("\n");
  }

  function buildApiInput(request) {
    const automaticLinks = formatLinkCandidatesForPrompt(request.linkCandidates || []);
    const collection = request.collectionInfo || {};
    const product = request.productInfo || {};

    return [
      `Hoofdzoekwoord: ${request.keyword}`,
      `Longtails: ${request.longtails.join(", ") || "geen"}`,
      `Paginatype: ${request.pageType}`,
      `Hubpagina: ${request.pageType === "hubpagina" ? "ja" : "nee"}`,
      `Collectiepagina: ${request.pageType === "collectie" ? "ja" : "nee"}`,
      `Merknaam bij collectie: ${collection.brandName || "niet van toepassing"}`,
      `Collectie/model bij collectie: ${collection.collectionName || "niet van toepassing"}`,
      `Productpagina: ${request.pageType === "product" ? "ja" : "nee"}`,
      `Productnaam: ${product.name || "niet van toepassing"}`,
      `Supplier ID: ${product.supplierPid || "niet van toepassing"}`,
      `EAN-codes: ${product.eans && product.eans.length ? product.eans.join(", ") : "niet van toepassing"}`,
      `Bestaande leverancierstekst/description: ${product.supplierDescriptionText || "niet beschikbaar"}`,
      `Gevonden productsamenstelling: ${product.compositionLines && product.compositionLines.length ? product.compositionLines.join(" | ") : "niet beschikbaar"}`,
      `URL/slug: ${request.url || "niet opgegeven"}`,
      `Handmatig opgegeven interne links: ${request.internalLinks || "geen"}`,
      `Automatisch geselecteerde interne linkkandidaten uit de linkdatabase:`,
      automaticLinks || "geen",
      `Extra instructies: ${request.extraInstruction || "geen"}`,
      "",
      "Schrijf een unieke tekst voor deze pagina.",
      request.pageType === "collectie"
        ? `Zoek op internet naar "${[collection.brandName, collection.collectionName].filter(Boolean).join(" ")}" en gebruik alleen informatie die je redelijk kunt onderbouwen. De tekst moet helpen verkopen zonder feiten te verzinnen.`
        : request.pageType === "product"
        ? `Zoek op internet naar "${[product.name, product.supplierPid, product.eans && product.eans[0]].filter(Boolean).join(" ")}" en schrijf een korte producttekst. Gebruik alleen productdetails die je redelijk kunt onderbouwen.`
        : request.pageType === "hubpagina"
        ? "Schrijf als overzichts-/hubpagina. Help de bezoeker kiezen en verwijs natuurlijk naar relevante onderliggende categorieën."
        : "Schrijf voor de gekozen pagina-intentie.",
      request.pageType === "collectie"
        ? "Verwerk merknaam en collectie/model natuurlijk in title, H1, meta description en meta keywords. Bepaal zelf passende longtails en neem die op in meta_keywords."
        : "",
      request.pageType === "collectie"
        ? "Link minimaal een keer naar de bovenliggende merkpagina als die bij de linkkandidaten staat. Gebruik daarnaast alleen merkgerelateerde of productgerelateerde links die echt passen."
        : "",
      request.pageType === "product"
        ? "Maak intro_html de volledige producttekst. Houd body_html leeg. Schrijf compact, concreet en verkoopgericht. Gebruik geen H2-koppen."
        : "",
      request.pageType === "product"
        ? "Gebruik de bestaande leverancierstekst zwaar bij je beoordeling. Sluit altijd af met <strong>Productsamenstelling</strong>. Als samenstelling betrouwbaar beschikbaar is, verwerk die feitelijk als opsomming met <ul><li>...</li></ul>. Als samenstelling echt niet betrouwbaar beschikbaar is, gebruik <i>Niet opgegeven door fabrikant</i>."
        : "",
      request.pageType === "product"
        ? "Gebruik geen interne links in de producttekst. Blijf bij dit specifieke product, de collectie/lijn, het model, pasvorm/uitstraling en de kleur. Noem geen supplier ID, geen EAN en geen kleurcode. Noem herkomst alleen als die betrouwbaar beschikbaar is."
        : "",
      request.pageType === "product"
        ? "Vul meta_description en meta_keywords productgericht in. Page title en H1 zijn voor productpagina's niet belangrijk als die velden ontbreken."
        : "",
      request.pageType === "product"
        ? "Zorg dat intro_html de volledige korte producttekst bevat, inclusief productsamenstelling als opsomming wanneer beschikbaar."
        : "Zorg dat intro_html alleen de eerste alinea bevat.",
      request.pageType === "product"
        ? "Zorg dat body_html leeg blijft, omdat productteksten geen footerstructuur nodig hebben."
        : "Zorg dat body_html alle footer content bevat, dus de H2-koppen en verdere alinea's.",
      "Kies alleen links uit de handmatig opgegeven links of automatische linkkandidaten.",
      `Gebruik maximaal ${DEFAULT_SETTINGS.maxLinksInText} interne links totaal.`,
      "De automatische linkkandidaten zijn vooraf geselecteerd op basis van hoofdzoekwoord, longtails en paginacontext. Gebruik vooral die relevantie, niet steeds dezelfde algemene blogs.",
      "Streef naar een natuurlijke mix van categoriepagina, merkpagina en eventueel een bloglink als die kandidaten relevant zijn.",
      "Gebruik een kandidaat alleen als de pagina inhoudelijk bij de alinea past.",
      "Gebruik geen markdown buiten de JSON.",
    ].join("\n");
  }

  function getSeoJsonSchema() {
    return {
      type: "object",
      additionalProperties: false,
      required: ["page_title", "header_title", "meta_description", "meta_keywords", "intro_html", "body_html", "seo_check"],
      properties: {
        page_title: { type: "string" },
        header_title: { type: "string" },
        meta_description: { type: "string" },
        meta_keywords: { type: "string" },
        intro_html: { type: "string" },
        body_html: { type: "string" },
        seo_check: {
          type: "object",
          additionalProperties: false,
          required: ["keyword_density", "h2_keyword_ratio", "notes"],
          properties: {
            keyword_density: { type: "string" },
            h2_keyword_ratio: { type: "string" },
            notes: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    };
  }

  function normalizeApiResult(apiResult, requestOrKeyword, maybeLongtails) {
    const request = typeof requestOrKeyword === "object"
      ? requestOrKeyword
      : { keyword: requestOrKeyword, longtails: maybeLongtails || [], linkCandidates: [] };
    const keyword = request.keyword;
    const longtails = request.longtails || [];
    const introHtml = polishBlogReferences(normalizeEmphasis(autoLinkWaszakje(apiResult.intro_html || buildIntroParagraph(keyword, longtails))));
    const bodyHtml = polishBlogReferences(normalizeEmphasis(autoLinkWaszakje(sanitizeHeadingColons(apiResult.body_html || ""))));
    const collection = request.collectionInfo || {};
    const product = request.productInfo || {};
    let pageTitle = sanitizeSeoLine(apiResult.page_title || buildPageTitle(keyword, longtails));
    let headerTitle = sanitizeSeoLine(apiResult.header_title || `${sentenceCase(keyword)} kopen`);
    let metaDescription = sanitizeSeoLine(apiResult.meta_description || "");
    let keywords = apiResult.meta_keywords || [keyword].concat(longtails).join(", ");

    if (request.pageType === "collectie") {
      pageTitle = ensureTermsInSeoLine(pageTitle, [collection.brandName, collection.collectionName], DEFAULT_SETTINGS.pageTitleMaxLength);
      headerTitle = ensureTermsInSeoLine(headerTitle, [collection.brandName, collection.collectionName], 90);
      metaDescription = ensureTermsInSeoLine(metaDescription, [collection.brandName, collection.collectionName], DEFAULT_SETTINGS.metaDescriptionMaxLength);
      keywords = ensureTermsInKeywordList(keywords, [keyword, collection.brandName, collection.collectionName]);
    }

    if (request.pageType === "product") {
      pageTitle = ensureTermsInSeoLine(pageTitle, [product.name], DEFAULT_SETTINGS.pageTitleMaxLength);
      headerTitle = ensureTermsInSeoLine(headerTitle, [product.name], 100);
      metaDescription = ensureTermsInSeoLine(metaDescription, [product.name], DEFAULT_SETTINGS.metaDescriptionMaxLength);
      keywords = ensureTermsInKeywordList(keywords, [keyword, product.name]);
      keywords = removeTermsFromKeywordList(keywords, [product.supplierPid].concat(product.eans || []));
    }
    const finalIntroHtml = request.pageType === "product" ? ensureProductCompositionBlock(stripInternalLinks(introHtml), product) : introHtml;
    const finalBodyHtml = request.pageType === "product" ? "" : bodyHtml;

    return {
      keyword,
      longtails,
      pageType: request.pageType || "",
      collectionInfo: request.collectionInfo || null,
      productInfo: request.productInfo || null,
      linkCandidates: request.linkCandidates || [],
      url: request.url || "",
      pageTitle,
      headerTitle,
      metaDescription,
      keywords,
      introHtml: finalIntroHtml,
      bodyHtml: finalBodyHtml,
      contentHtml: [finalIntroHtml, finalBodyHtml].filter(Boolean).join("\n"),
      seoCheck: apiResult.seo_check || null,
    };
  }

  function ensureTermsInSeoLine(value, terms, maxLength) {
    const required = (terms || []).map(cleanWhitespace).filter(Boolean);
    if (!required.length) return value;

    const normalized = normalizeForSearch(value);
    const missing = required.filter((term) => !normalized.includes(normalizeForSearch(term)));
    if (!missing.length) return value;

    const prefix = missing.join(" ");
    const next = cleanWhitespace(`${prefix} ${value}`);
    return maxLength ? clampSentence(next, maxLength) : next;
  }

  function ensureTermsInKeywordList(value, terms) {
    const items = String(value || "")
      .split(/[,;\n]/)
      .map(cleanWhitespace)
      .filter(Boolean);
    const seen = new Set(items.map(normalizeForSearch));

    (terms || []).map(cleanWhitespace).filter(Boolean).forEach((term) => {
      const key = normalizeForSearch(term);
      if (!seen.has(key)) {
        items.unshift(term);
        seen.add(key);
      }
    });

    return items.join(", ");
  }

  function removeTermsFromKeywordList(value, terms) {
    const blocked = new Set((terms || []).map(normalizeForSearch).filter(Boolean));
    if (!blocked.size) return value;

    return String(value || "")
      .split(/[,;\n]/)
      .map(cleanWhitespace)
      .filter(Boolean)
      .filter((item) => !blocked.has(normalizeForSearch(item)))
      .join(", ");
  }

  function sanitizeSeoLine(value) {
    return cleanWhitespace(value).replace(/\s*:\s*/g, " - ");
  }

  function sanitizeHeadingColons(html) {
    return String(html || "").replace(/(<h[1-6][^>]*>)(.*?)(<\/h[1-6]>)/gis, (match, open, text, close) => {
      return `${open}${text.replace(/\s*:\s*/g, " - ")}${close}`;
    });
  }

  function autoLinkWaszakje(html) {
    return linkFirstTextOccurrence(html, /\bwaszakjes?\b/i, DEFAULT_SETTINGS.waszakjeUrl);
  }

  function normalizeEmphasis(html) {
    const placeholder = "__SEO_WRITER_FREE_SHIPPING_PLACEHOLDER__";
    return String(html || "")
      .replace(/\*\*ORDER_PRICE_FREE_SHIPPING\*\*/g, placeholder)
      .replace(/\*([^*<>][^*]*?)\*/g, "<em>$1</em>")
      .replace(new RegExp(placeholder, "g"), "**ORDER_PRICE_FREE_SHIPPING**");
  }

  function polishBlogReferences(html) {
    return String(html || "")
      .replace(/\bons blog met advies over\s+(<em>\s*)?(<a\b[^>]*>.*?<\/a>)(\s*<\/em>)?/gi, "ons blog over $1$2$3")
      .replace(/\bin ons blog met advies over\s+(<em>\s*)?(<a\b[^>]*>.*?<\/a>)(\s*<\/em>)?/gi, "in ons blog over $1$2$3")
      .replace(/\bhet blog met advies over\s+(<em>\s*)?(<a\b[^>]*>.*?<\/a>)(\s*<\/em>)?/gi, "het blog over $1$2$3");
  }

  function stripInternalLinks(html) {
    const container = document.createElement("div");
    container.innerHTML = String(html || "");
    container.querySelectorAll("a").forEach((link) => {
      link.replaceWith(document.createTextNode(link.textContent || ""));
    });
    return container.innerHTML;
  }

  function ensureProductCompositionBlock(html, product) {
    const source = String(html || "");
    if (/productsamenstelling/i.test(source)) return source;

    const compositionLines = product && Array.isArray(product.compositionLines)
      ? product.compositionLines
      : [];
    const block = compositionLines.length
      ? `<p><strong>Productsamenstelling</strong></p><ul>${compositionLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
      : `<p><strong>Productsamenstelling</strong></p><p><i>Niet opgegeven door fabrikant</i></p>`;

    return [source, block].filter(Boolean).join("\n");
  }

  function linkFirstTextOccurrence(html, pattern, href) {
    const source = String(html || "");
    if (!pattern.test(source)) return source;

    const container = document.createElement("div");
    container.innerHTML = source;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("a")) return NodeFilter.FILTER_REJECT;
        return pattern.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    const textNode = walker.nextNode();
    if (!textNode) return source;

    const match = textNode.nodeValue.match(pattern);
    if (!match) return source;

    const before = textNode.nodeValue.slice(0, match.index);
    const linkedText = match[0];
    const after = textNode.nodeValue.slice(match.index + linkedText.length);
    const fragment = document.createDocumentFragment();

    if (before) fragment.appendChild(document.createTextNode(before));

    const link = document.createElement("a");
    link.href = href;
    link.textContent = linkedText;
    fragment.appendChild(link);

    if (after) fragment.appendChild(document.createTextNode(after));

    textNode.parentNode.replaceChild(fragment, textNode);
    return container.innerHTML;
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...options,
        onload: resolve,
        onerror: () => reject(new Error("Netwerkfout bij API-aanroep.")),
        ontimeout: () => reject(new Error("API-aanroep duurde te lang.")),
        timeout: 90000,
      });
    });
  }

  function extractOutputText(data) {
    const chunks = [];
    const output = Array.isArray(data.output) ? data.output : [];

    output.forEach((item) => {
      const content = Array.isArray(item.content) ? item.content : [];
      content.forEach((part) => {
        if (part && part.type === "output_text" && part.text) chunks.push(part.text);
      });
    });

    return chunks.join("\n").trim();
  }

  function extractApiError(responseText) {
    try {
      const data = JSON.parse(responseText);
      return data.error && data.error.message ? data.error.message : "";
    } catch (_) {
      return responseText ? responseText.slice(0, 180) : "";
    }
  }

  async function getRankedLinkCandidates(request) {
    try {
      const rows = await getLinkDatabaseRows();
      if (!rows.length) {
        throw new Error("Linkdatabase bevat geen bruikbare rijen. Controleer of de sheet openbaar is en de kolommen exact kloppen.");
      }

      const candidates = rows
        .map((row) => ({ ...row, score: scoreLinkCandidate(row, request) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || Number(a.link_priority || 9) - Number(b.link_priority || 9));

      return diversifyLinkCandidates(candidates).slice(0, DEFAULT_SETTINGS.maxLinkCandidates);
    } catch (error) {
      console.warn("[SEO writer] Linkdatabase kon niet worden geladen:", error);
      const status = document.getElementById("seo-writer-status");
      if (status) status.textContent = `Linkdatabase overgeslagen: ${error.message}`;
      return [];
    }
  }

  function diversifyLinkCandidates(candidates) {
    const caps = { blog: 3, category: 5, brand: 4, other: 2 };
    const counts = { blog: 0, category: 0, brand: 0, other: 0 };
    const seenAnchors = new Set();
    const selected = [];

    candidates.forEach((candidate) => {
      const type = getCandidateBucket(candidate);
      const anchorKey = normalizeForSearch(candidate.suggested_anchor || candidate.primary_topic || candidate.slug);
      if (seenAnchors.has(anchorKey)) return;
      if (counts[type] >= caps[type]) return;

      counts[type] += 1;
      seenAnchors.add(anchorKey);
      selected.push(candidate);
    });

    return selected;
  }

  function getCandidateBucket(candidate) {
    const type = normalizeForSearch(candidate.page_type || inferLinkTypeFromSlug(candidate.slug));
    if (type.includes("blog")) return "blog";
    if (type.includes("categorie")) return "category";
    if (type.includes("merk")) return "brand";
    return "other";
  }

  async function getLinkDatabaseRows() {
    const cacheKey = "seoWriterLinkDatabaseCache.v1";
    const cacheTimeKey = "seoWriterLinkDatabaseCacheTime.v1";
    const cached = getStoredValue(cacheKey, "");
    const cachedAt = Number(getStoredValue(cacheTimeKey, 0));
    const cacheIsFresh = cached && cachedAt && Date.now() - cachedAt < 1000 * 60 * 30;

    if (cacheIsFresh) {
      return JSON.parse(cached);
    }

    const response = await gmRequest({
      method: "GET",
      url: DEFAULT_SETTINGS.linkSheetCsvUrl,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Linkdatabase HTTP ${response.status}`);
    }

    const rows = parseLinkCsv(response.responseText)
      .map(normalizeLinkRow)
      .filter(isUsableLinkRow);

    setStoredValue(cacheKey, JSON.stringify(rows));
    setStoredValue(cacheTimeKey, String(Date.now()));

    return rows;
  }

  function parseLinkCsv(csvText) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i += 1) {
      const char = csvText[i];
      const next = csvText[i + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          value += '"';
          i += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          value += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(value);
        value = "";
      } else if (char === "\n") {
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else if (char !== "\r") {
        value += char;
      }
    }

    if (value.length || row.length) {
      row.push(value);
      rows.push(row);
    }

    const headers = (rows.shift() || []).map((header) => cleanWhitespace(header));
    return rows
      .filter((cells) => cells.some((cell) => cleanWhitespace(cell)))
      .map((cells) => {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = cleanWhitespace(cells[index] || "");
        });
        return record;
      });
  }

  function normalizeLinkRow(row) {
    const slug = normalizeSlug(row.slug);

    return {
      slug,
      page_type: row.page_type || "",
      primary_topic: row.primary_topic || "",
      secondary_topics: row.secondary_topics || "",
      product_group: row.product_group || "",
      audience_intent: row.audience_intent || "",
      tags: row.tags || "",
      suggested_anchor: row.suggested_anchor || row.primary_topic || "",
      link_priority: Number(row.link_priority || 3),
      exclude_from_auto_links: String(row.exclude_from_auto_links || "").toLowerCase() === "true",
      notes: row.notes || "",
    };
  }

  function isUsableLinkRow(row) {
    return Boolean(row.slug)
      && row.link_priority > 0
      && !row.exclude_from_auto_links;
  }

  function scoreLinkCandidate(row, request) {
    const currentSlug = normalizeSlug(request.url);
    if (currentSlug && row.slug === currentSlug) return 0;

    const priorityScore = row.link_priority === 1 ? 8 : row.link_priority === 2 ? 4 : 1;
    const queryPhrases = expandLinkQueryPhrases([request.keyword].concat(request.longtails || []))
      .map(normalizeForSearch)
      .filter(Boolean);
    const queryTokens = tokenizeSearch(queryPhrases.join(" "));
    const tagTokens = tokenizeSearch(row.tags);
    const searchable = normalizeForSearch([
      row.slug,
      row.page_type,
      row.primary_topic,
      row.secondary_topics,
      row.product_group,
      row.audience_intent,
      row.tags,
      row.suggested_anchor,
      row.notes,
    ].join(" "));

    let score = priorityScore;
    score += getLinkContextScore(row, currentSlug, normalizeForSearch([request.keyword].concat(request.longtails || []).join(" "))) * 0.6;
    if (request.pageType === "hubpagina" && isDirectChildSlug(row.slug, currentSlug)) score += 20;
    if (request.pageType === "collectie") {
      const collection = request.collectionInfo || {};
      const brandNeedle = normalizeForSearch(collection.brandName || "");
      const modelNeedle = normalizeForSearch(collection.collectionName || "");
      const isBrandBucket = getCandidateBucket(row) === "brand";

      if (brandNeedle && searchable.includes(brandNeedle)) score += isBrandBucket ? 32 : 16;
      if (modelNeedle && searchable.includes(modelNeedle)) score += 12;
      if (brandNeedle && isBrandBucket && slugLooksLikeBrand(row.slug, brandNeedle)) score += 16;
    }

    if (request.pageType === "product") {
      const product = request.productInfo || {};
      const productName = normalizeForSearch(product.name || request.keyword);
      const supplierPid = normalizeForSearch(product.supplierPid || "");
      const productTokens = tokenizeSearch(productName);
      const isBrandBucket = getCandidateBucket(row) === "brand";

      productTokens.forEach((token) => {
        if (searchable.includes(token)) score += isBrandBucket ? 3 : 1.5;
      });
      if (supplierPid && searchable.includes(supplierPid)) score += 14;
    }

    queryPhrases.forEach((phrase, index) => {
      if (!phrase) return;
      if (searchable.includes(phrase)) score += index === 0 ? 18 : 10;
    });

    const topicScore = getTopicalOverlapScore(queryPhrases, searchable);
    score += topicScore;

    queryTokens.forEach((token) => {
      if (tagTokens.includes(token)) score += 4;
      else if (searchable.includes(token)) score += 1.5;
    });

    if (isColorQuery(request)) {
      const colorContext = ["kleur", "kleuren", "wassen", "wasadvies", "onderhoud", "huidtint", "huidskleur", "styling"];
      if (colorContext.some((term) => searchable.includes(term))) score += 10;
      if (searchable.includes("soorten bh")) score -= 6;
    }

    if (row.audience_intent === "sale" && !searchable.includes("sale")) score -= 1;
    if (row.link_priority === 3 && score < 18) return 0;
    if (score < 10) return 0;

    return score;
  }

  function expandLinkQueryPhrases(values) {
    const phrases = [];

    values.forEach((value) => {
      const normalized = normalizeForSearch(value);
      if (!normalized) return;
      phrases.push(normalized);

      const tokens = normalized.split(" ").filter(Boolean);
      [3, 2].forEach((size) => {
        for (let i = 0; i <= tokens.length - size; i += 1) {
          const phrase = tokens.slice(i, i + size).join(" ");
          if (isUsefulLinkPhrase(phrase)) phrases.push(phrase);
        }
      });
    });

    return Array.from(new Set(phrases));
  }

  function isUsefulLinkPhrase(phrase) {
    const usefulTerms = ["bh", "bikini", "badpak", "tankini", "push up", "t shirt", "balconette", "strapless", "beugel", "zonder beugel", "met beugel", "voorgevormde", "sport", "voeding", "zwangerschap"];
    return usefulTerms.some((term) => phrase.includes(term));
  }

  function getTopicalOverlapScore(queryPhrases, searchable) {
    let score = 0;
    queryPhrases.forEach((phrase) => {
      const parts = phrase.split(" ").filter(Boolean);
      if (parts.length < 2) return;
      const matches = parts.filter((part) => searchable.includes(part)).length;
      if (matches >= 2) score += parts.length >= 3 ? 5 : 3;
    });
    return Math.min(score, 14);
  }

  function formatLinkCandidatesForPrompt(candidates) {
    return candidates.map((candidate, index) => {
      return [
        `${index + 1}. URL: ${candidate.slug}`,
        `Anchor: ${candidate.suggested_anchor}`,
        `Type: ${candidate.page_type}`,
        `Intentie: ${candidate.audience_intent}`,
        `Onderwerp: ${candidate.primary_topic}`,
        `Subonderwerpen: ${candidate.secondary_topics || "geen"}`,
        `Tags: ${candidate.tags}`,
        `Priority: ${candidate.link_priority}`,
        `Score: ${candidate.score.toFixed(1)}`,
      ].join(" | ");
    }).join("\n");
  }

  function normalizeSlug(slug) {
    const clean = cleanWhitespace(slug);
    if (!clean) return "";

    try {
      const url = new URL(clean);
      return cleanWhitespace(url.pathname).replace(/\/+$/, "") || "/";
    } catch (_) {
      return clean.startsWith("/") ? clean.replace(/\/+$/, "") : `/${clean.replace(/^\/+|\/+$/g, "")}`;
    }
  }

  function normalizeForSearch(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " en ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenizeSearch(value) {
    const keepShort = new Set(["bh"]);
    const stopwords = new Set(["voor", "een", "het", "de", "en", "van", "bij", "sale"]);
    return Array.from(new Set(normalizeForSearch(value)
      .split(" ")
      .filter((token) => (token.length >= 3 || keepShort.has(token)) && !stopwords.has(token))));
  }

  function isColorQuery(request) {
    const haystack = normalizeForSearch([request.keyword].concat(request.longtails || []).join(" "));
    const colors = ["rood", "rode", "blauw", "blauwe", "groen", "groene", "geel", "gele", "zwart", "zwarte", "wit", "witte", "beige", "nude", "roze", "paars", "oranje", "bruin", "bruine"];
    return colors.some((color) => haystack.includes(color));
  }

  function slugLooksLikeBrand(slug, brandNeedle) {
    const slugText = normalizeForSearch(String(slug || "").replace(/\//g, " "));
    const compactSlug = slugText.replace(/\s+/g, "");
    const compactBrand = normalizeForSearch(brandNeedle).replace(/\s+/g, "");
    if (!compactBrand) return false;
    return compactSlug.includes(compactBrand) || compactBrand.includes(compactSlug);
  }

  function parseKeywordInput(input) {
    const parts = input.split(/\t|\|/).map((part) => part.trim()).filter(Boolean);
    const keyword = parts[0] || "";
    const longtails = (parts[1] || "")
      .split(/[,;\n]/)
      .map((item) => cleanWhitespace(item))
      .filter(Boolean);

    return { keyword: cleanWhitespace(keyword), longtails };
  }

  function normalizeVisibleSeparator(field) {
    const visibleValue = field.value.replace(/\t/g, " | ");
    if (visibleValue === field.value) return;

    const cursorPosition = field.selectionStart;
    const tabsBeforeCursor = field.value.slice(0, cursorPosition).match(/\t/g);
    field.value = visibleValue.replace(/\s+\|\s+/g, " | ");

    if (typeof cursorPosition === "number") {
      const offset = tabsBeforeCursor ? tabsBeforeCursor.length * 2 : 0;
      field.setSelectionRange(cursorPosition + offset, cursorPosition + offset);
    }
  }

  function generateSeoText(keyword, longtails, extraInstruction) {
    const primary = sentenceCase(keyword);
    const pageTitle = buildPageTitle(keyword, longtails);
    const headerTitle = `${primary} kopen`;
    const metaDescription = clampSentence(
      `Ontdek waar je op let bij ${keyword}. Praktisch advies over pasvorm, comfort en stijl, zodat je makkelijker de juiste keuze maakt.`,
      DEFAULT_SETTINGS.metaDescriptionMaxLength
    );
    const keywords = [keyword].concat(longtails).join(", ");
    const intro = buildIntroParagraph(keyword, longtails);
    const bodySections = buildBodySections(keyword, longtails, extraInstruction);

    return {
      keyword,
      longtails,
      linkCandidates: [],
      url: "",
      pageTitle,
      headerTitle,
      metaDescription,
      keywords,
      introHtml: intro,
      bodyHtml: bodySections.join("\n"),
      contentHtml: [intro].concat(bodySections).join("\n"),
    };
  }

  function buildPageTitle(keyword, longtails) {
    const primary = sentenceCase(keyword);
    const options = [
      `${primary} voor super scherpe prijzen`,
      `${primary} in elke tint en pasvorm`,
      `${primary} die echt lekker zit`,
      `${primary}: zo kies je de juiste pasvorm`,
      `${primary} kopen zonder maatstress`,
      `${primary} voor comfort en zelfvertrouwen`,
    ];

    if (longtails.length) {
      options.unshift(`${primary}: tips voor ${longtails[0]}`);
    }

    return clampSentence(options.find((option) => option.length <= DEFAULT_SETTINGS.pageTitleMaxLength) || options[0], DEFAULT_SETTINGS.pageTitleMaxLength);
  }

  function buildIntroParagraph(keyword, longtails) {
    const safeKeyword = escapeHtml(sentenceCase(keyword));
    const safeLongtails = longtails.slice(0, 3).map(escapeHtml);
    const longtailText = safeLongtails.length ? ` Ook gerelateerde zoekopdrachten zoals ${joinReadable(safeLongtails)} komen hierbij terug.` : "";
    return `<p style="text-align: justify;">${safeKeyword} vraagt om duidelijke informatie, een prettig leesbare uitleg en praktische keuzes die passen bij wat je zoekt.${longtailText} Op deze pagina vind je een heldere introductie die bezoekers helpt om snel te begrijpen waar ze op moeten letten en welke optie het beste aansluit bij hun wensen.</p>`;
  }

  function buildBodySections(keyword, longtails, extraInstruction) {
    const sectionTopics = [
      {
        heading: `${sentenceCase(keyword)} draait om de juiste keuze`,
        text: `Bij ${keyword} is het belangrijk om niet alleen naar de naam of categorie te kijken, maar ook naar gebruik, pasvorm, uitstraling en praktische voordelen. Een goede tekst helpt bezoekers om sneller vertrouwen te krijgen in het aanbod en voorkomt dat belangrijke informatie verspreid of onduidelijk blijft.`,
      },
      {
        heading: `Waar let je op bij ${keyword}?`,
        text: `Let vooral op de details die voor jouw situatie het verschil maken. Denk aan maat, materiaal, stijl, beschikbaarheid en de manier waarop het product of onderwerp aansluit bij dagelijks gebruik. Door deze punten helder te benoemen, wordt de keuze makkelijker en voelt de pagina relevanter voor bezoekers die gericht zoeken.`,
      },
      {
        heading: `Meer informatie over ${keyword}`,
        text: `Wie zoekt naar ${keyword} gebruikt vaak meerdere termen om hetzelfde doel te bereiken. Daarom is het verstandig om de belangrijkste varianten natuurlijk in de tekst te verwerken. Zo blijft de pagina prettig leesbaar, terwijl zoekmachines beter begrijpen welke onderwerpen en intenties bij deze pagina horen.`,
      },
    ];

    if (longtails.length) {
      sectionTopics.splice(2, 0, {
        heading: `Populaire zoekopdrachten rond ${keyword}`,
        text: `Termen zoals ${joinReadable(longtails)} geven extra richting aan de tekst. Ze laten zien welke vragen, voorkeuren of productvarianten belangrijk zijn voor bezoekers. Door deze longtails logisch terug te laten komen in kopjes en alinea's ontstaat een complete SEO-tekst zonder dat de inhoud geforceerd aanvoelt.`,
      });
    }

    if (extraInstruction) {
      sectionTopics.push({
        heading: `Advies bij ${keyword}`,
        text: `Voor deze tekst geldt als extra richting: ${extraInstruction}. Gebruik die invalshoek om de inhoud concreet, behulpzaam en commercieel bruikbaar te maken, zonder de lezer te overladen met herhaling of losse zoektermen.`,
      });
    }

    return sectionTopics.map((section) => {
      return `<h2 style="text-align: center;">${escapeHtml(section.heading)}</h2>\n<p style="text-align: justify;">${escapeHtml(section.text)}</p>`;
    });
  }

  function getCurrentCmsResultForAnalysis() {
    const request = getSeoRequestInput();
    if (!request) return null;

    const contentTargets = getContentTargets();
    const introHtml = contentTargets.main ? getEditorHtml(contentTargets.main) : "";
    const bodyHtml = contentTargets.footer ? getEditorHtml(contentTargets.footer) : "";

    const result = {
      keyword: request.keyword,
      longtails: request.longtails,
      pageType: request.pageType,
      collectionInfo: request.collectionInfo || null,
      productInfo: request.productInfo || null,
      linkCandidates: lastSeoState.request && lastSeoState.request.linkCandidates ? lastSeoState.request.linkCandidates : [],
      url: request.url,
      pageTitle: getFieldValue(SELECTORS.pageTitle),
      headerTitle: getFieldValue(SELECTORS.headerTitle),
      metaDescription: getFieldValue(SELECTORS.description),
      keywords: getFieldValue(SELECTORS.keywords),
      introHtml,
      bodyHtml,
      contentHtml: [introHtml, bodyHtml].filter(Boolean).join("\n"),
    };

    lastSeoState.request = request;
    lastSeoState.result = result;
    return result;
  }

  function getFieldValue(selector) {
    const field = document.querySelector(selector);
    return field ? field.value || "" : "";
  }

  function getEditorHtml(textarea) {
    if (!textarea) return "";

    const tiny = window.tinyMCE || window.tinymce;
    const editorId = textarea.id || "";
    const editor = getTinyMceEditor(tiny, editorId);

    if (editor && typeof editor.getContent === "function") {
      return editor.getContent();
    }

    const iframe = editorId ? document.getElementById(`${editorId}_ifr`) : null;
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      return iframe.contentDocument.body.innerHTML;
    }

    return textarea.value || "";
  }

  function renderSeoAnalysis(result) {
    const panel = document.getElementById("seo-writer-analysis");
    const host = document.getElementById("seo-writer-analysis-content");
    if (!panel || !host || !result) return;

    lastSeoState.result = result;
    const analysis = analyzeSeoResult(result);
    host.innerHTML = buildAnalysisHtml(analysis);
    panel.style.display = "block";
    panel.open = true;
  }

  function analyzeSeoResult(result) {
    const html = [result.introHtml, result.bodyHtml].filter(Boolean).join("\n");
    const text = htmlToPlainText(html);
    const words = getWords(text);
    const sentences = getSentences(text);
    const sentenceStats = getSentenceStats(sentences);
    const exactKeyword = countPhrase(text, result.keyword || "");
    const exactKeywordDensity = words.length ? (exactKeyword / words.length) * 100 : 0;
    const h1Count = result.headerTitle ? 1 : 0;
    const h2Count = (html.match(/<h2\b/gi) || []).length;
    const headingCount = (html.match(/<h[1-6]\b/gi) || []).length + h1Count;
    const linkAnalysis = analyzeInternalLinks(html, result.linkCandidates || []);
    const missedLinkOpportunities = findMissedLinkOpportunities(html, text, linkAnalysis.urls, result);
    const firstLastKeyword = analyzeFirstLastKeyword(result);
    const forbiddenFormulas = findForbiddenFormulas([result.pageTitle, result.headerTitle, result.metaDescription, text].join(" "));
    const repeatedStarters = findRepeatedSentenceStarters(sentences);
    const pageTitleCheck = {
      length: cleanWhitespace(result.pageTitle || "").length,
      ok: cleanWhitespace(result.pageTitle || "").length >= DEFAULT_SETTINGS.pageTitleMinLength && cleanWhitespace(result.pageTitle || "").length <= DEFAULT_SETTINGS.pageTitleMaxLength,
    };
    const metaDescriptionCheck = {
      length: cleanWhitespace(result.metaDescription || "").length,
      ok: cleanWhitespace(result.metaDescription || "").length <= DEFAULT_SETTINGS.metaDescriptionMaxLength,
    };
    const readingMinutes = Math.max(1, Math.ceil(words.length / 200));
    const readability = getReadability(text, words, sentences);
    const density = {
      x1: getTopNgrams(words, 1, 8),
      x2: getTopNgrams(words, 2, 8),
      x3: getTopNgrams(words, 3, 8),
    };
    const suggestions = getAnalysisSuggestions({
      words,
      sentences,
      sentenceStats,
      exactKeywordDensity,
      h2Count,
      result,
      linkAnalysis,
      missedLinkOpportunities,
      firstLastKeyword,
      forbiddenFormulas,
      repeatedStarters,
      pageTitleCheck,
      metaDescriptionCheck,
    });

    return {
      wordCount: words.length,
      headingCount,
      h1Count,
      h2Count,
      exactKeyword,
      exactKeywordDensity,
      density,
      sentenceCount: sentences.length,
      longestSentence: sentenceStats.longest,
      shortestSentence: sentenceStats.shortest,
      linkAnalysis,
      missedLinkOpportunities,
      firstLastKeyword,
      forbiddenFormulas,
      repeatedStarters,
      pageTitleCheck,
      metaDescriptionCheck,
      readingMinutes,
      readability,
      suggestions,
    };
  }

  function buildAnalysisHtml(analysis) {
    return `
      <div class="seo-analysis-grid">
        ${analysisItem(`Kopjes: ${analysis.headingCount}`, `${analysis.h1Count}x H1<br>${analysis.h2Count}x H2`)}
        ${analysisItem("Woorden", String(analysis.wordCount))}
        ${analysisItem("Keyword density", `${analysis.exactKeyword}x hoofdzoekwoord, ${analysis.exactKeywordDensity.toFixed(2)}%`)}
        ${analysisItem("Leestijd", `${analysis.readingMinutes} min`)}
        ${analysisItem("Leesniveau", `${analysis.readability.label} (${analysis.readability.score.toFixed(0)})`)}
        ${analysisItem(`Zinnen: ${analysis.sentenceCount}`, `kortste ${analysis.shortestSentence.wordCount || 0} woorden<br>langste ${analysis.longestSentence.wordCount || 0} woorden<br>richtlijn rond 15`)}
        ${analysisItem("Title/meta", `Title: ${analysis.pageTitleCheck.length} tekens (${analysis.pageTitleCheck.ok ? "ok" : "check"})<br>Meta: ${analysis.metaDescriptionCheck.length} tekens (${analysis.metaDescriptionCheck.ok ? "ok" : "check"})`)}
        ${analysisItem("Keywordpositie", `${analysis.firstLastKeyword.first ? "✅" : "❌"} eerste alinea<br>${analysis.firstLastKeyword.last ? "✅" : "❌"} laatste alinea`)}
        ${analysisItem("Verboden formules", analysis.forbiddenFormulas.length ? analysis.forbiddenFormulas.map(escapeHtml).join(", ") : "Geen gevonden")}
        ${analysisItem(`Interne links: ${analysis.linkAnalysis.total}`, formatLinkAnalysis(analysis.linkAnalysis), true)}
        ${analysisItem("Density", formatDensityTabs(analysis.density), true)}
        ${analysisItem(`Langste zin: ${analysis.longestSentence.wordCount || 0} woorden`, escapeHtml(analysis.longestSentence.text || "-"), true)}
        ${analysisItem("Gemiste linkkansen", formatLinkOpportunities(analysis.missedLinkOpportunities), true)}
        ${analysisItem("Suggesties", formatSuggestions(analysis.suggestions), true)}
      </div>
    `;
  }

  function analysisItem(label, value, wide) {
    return `
      <div class="seo-analysis-item${wide ? " seo-analysis-wide" : ""}">
        <div class="seo-analysis-label">${escapeHtml(label)}</div>
        <div class="seo-analysis-value">${value}</div>
      </div>
    `;
  }

  function formatNgrams(items) {
    if (!items.length) return "-";
    return items.map((item) => `${escapeHtml(item.term)} (${item.count}x, ${item.density.toFixed(1)}%)`).join(", ");
  }

  function formatDensityTabs(density) {
    return `
      <div class="seo-density-tabs">
        <button type="button" class="seo-density-tab is-active" data-density="1">x1</button>
        <button type="button" class="seo-density-tab" data-density="2">x2</button>
        <button type="button" class="seo-density-tab" data-density="3">x3</button>
      </div>
      ${densityTable("1", density.x1, true)}
      ${densityTable("2", density.x2, false)}
      ${densityTable("3", density.x3, false)}
    `;
  }

  function densityTable(size, items, active) {
    const rows = items.length
      ? items.map((item) => `<tr><td>${escapeHtml(item.term)}</td><td>${item.count}</td><td>${item.density.toFixed(1)}%</td></tr>`).join("")
      : `<tr><td colspan="3">Geen opvallende herhaling.</td></tr>`;

    return `
      <table class="seo-density-table" data-density-panel="${size}" style="${active ? "" : "display:none"}">
        <thead><tr><th>Term</th><th>Aantal</th><th>Density</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function setDensityTab(size) {
    document.querySelectorAll(".seo-density-tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.density === size);
    });

    document.querySelectorAll(".seo-density-table").forEach((table) => {
      table.style.display = table.dataset.densityPanel === size ? "" : "none";
    });
  }

  function formatLinkAnalysis(analysis) {
    return `
      <table class="seo-link-table">
        <thead><tr><th>Blog: ${analysis.blog}</th><th>Categorie: ${analysis.category}</th><th>Merk: ${analysis.brand}</th><th>Overig: ${analysis.other}</th></tr></thead>
        <tbody>
          <tr>
            <td>${formatSlugList(analysis.groups.blog)}</td>
            <td>${formatSlugList(analysis.groups.category)}</td>
            <td>${formatSlugList(analysis.groups.brand)}</td>
            <td>${formatSlugList(analysis.groups.other)}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  function formatSlugList(slugs) {
    if (!slugs.length) return "-";
    return slugs.map((slug) => `<div>${escapeHtml(slug)}</div>`).join("");
  }

  function formatLinkOpportunities(opportunities) {
    if (!opportunities.length) return "Geen duidelijke gemiste linkkansen.";
    return `<ul class="seo-analysis-list">${opportunities.map((item) => `
      <li>
        ${escapeHtml(item.anchor)} → ${escapeHtml(item.slug)}
        <span style="color:#64748b">(${escapeHtml(item.reason)})</span>
        <button type="button" class="seo-analysis-fix" data-issue="missed_link_opportunities" title="Herstel met AI">🤖</button>
      </li>
    `).join("")}</ul>`;
  }

  function findMissedLinkOpportunities(html, text, linkedUrls, result) {
    const linked = new Set((linkedUrls || []).map(normalizeSlug));
    const normalizedText = normalizeForSearch(text);
    const currentSlug = normalizeSlug(result && result.url ? result.url : "");
    const rows = getCachedLinkDatabaseRows()
      .filter(isUsableLinkRow)
      .filter((row) => !linked.has(normalizeSlug(row.slug)));

    const opportunities = [];

    rows.forEach((row) => {
      const anchor = cleanWhitespace(row.suggested_anchor || row.primary_topic || "");
      const anchorMatch = anchor && normalizeForSearch(anchor).length >= 5 && normalizedText.includes(normalizeForSearch(anchor));
      const topicMatch = row.primary_topic && normalizeForSearch(row.primary_topic).length >= 5 && normalizedText.includes(normalizeForSearch(row.primary_topic));
      const colorWhiteBraMatch = isWhiteBraColorBlog(row, normalizedText);

      if (!anchorMatch && !topicMatch && !colorWhiteBraMatch) return;

      const contextScore = getLinkContextScore(row, currentSlug, normalizedText);
      if (contextScore < -4) return;

      opportunities.push({
        slug: normalizeSlug(row.slug),
        anchor: anchor || row.primary_topic || row.slug,
        pageType: row.page_type,
        reason: colorWhiteBraMatch ? "kleur/onder witte kleding genoemd" : anchorMatch ? "anchor komt letterlijk voor" : "onderwerp komt letterlijk voor",
        priority: Number(row.link_priority || 3),
        score: contextScore + (4 - Number(row.link_priority || 3)),
      });
    });

    return dedupeLinkOpportunities(opportunities)
      .sort((a, b) => b.score - a.score || a.priority - b.priority || a.anchor.localeCompare(b.anchor))
      .slice(0, 6);
  }

  function getLinkContextScore(row, currentSlug, normalizedText) {
    const candidateSlug = normalizeSlug(row.slug);
    const currentSection = getTopSlugSection(currentSlug);
    const candidateSection = getTopSlugSection(candidateSlug);
    const currentSecond = getSecondSlugSection(currentSlug);
    const candidateSecond = getSecondSlugSection(candidateSlug);
    let score = 0;

    if (currentSection && candidateSection && currentSection === candidateSection) score += 8;
    if (currentSecond && candidateSecond && currentSecond === candidateSecond) score += 5;

    if (currentSection === "lingerie" && ["badmode", "sport"].includes(candidateSection)) score -= 10;
    if (currentSection === "badmode" && candidateSection === "lingerie") score -= 4;
    if (currentSection === "sport" && candidateSection !== "sport") score -= 4;

    if (currentSlug.includes("/lingerie/bh") && candidateSlug.includes("/lingerie/bh")) score += 10;
    if (normalizedText.includes("bh met beugel") && candidateSlug === "/lingerie/bh/met-beugel") score += 14;
    if (normalizedText.includes("bh zonder beugel") && candidateSlug === "/lingerie/bh/zonder-beugel") score += 14;
    if (candidateSlug.includes("/badmode/") && !normalizedText.includes("badmode") && !normalizedText.includes("bikini") && !normalizedText.includes("badpak") && !normalizedText.includes("tankini")) score -= 8;
    if (candidateSlug.includes("/sport/") && !normalizedText.includes("sport")) score -= 8;

    return score;
  }

  function dedupeLinkOpportunities(opportunities) {
    const byAnchor = new Map();
    opportunities.forEach((item) => {
      const key = normalizeForSearch(item.anchor);
      const current = byAnchor.get(key);
      if (!current || item.score > current.score) byAnchor.set(key, item);
    });
    return Array.from(byAnchor.values());
  }

  function getTopSlugSection(slug) {
    return normalizeSlug(slug).split("/").filter(Boolean)[0] || "";
  }

  function getSecondSlugSection(slug) {
    return normalizeSlug(slug).split("/").filter(Boolean)[1] || "";
  }

  function isDirectChildSlug(candidateSlug, parentSlug) {
    const candidateParts = normalizeSlug(candidateSlug).split("/").filter(Boolean);
    const parentParts = normalizeSlug(parentSlug).split("/").filter(Boolean);
    if (!candidateParts.length || !parentParts.length) return false;
    if (candidateParts.length !== parentParts.length + 1) return false;
    return parentParts.every((part, index) => candidateParts[index] === part);
  }

  function isWhiteBraColorBlog(row, normalizedText) {
    const rowText = normalizeForSearch([row.slug, row.primary_topic, row.secondary_topics, row.tags, row.suggested_anchor].join(" "));
    const isRelevantBlog = normalizeForSearch(row.page_type).includes("blog")
      && rowText.includes("kleur")
      && rowText.includes("witte")
      && rowText.includes("bh");
    const textMentionsContext = normalizedText.includes("witte kleding")
      || normalizedText.includes("witte blouse")
      || normalizedText.includes("witte top")
      || normalizedText.includes("onder wit")
      || normalizedText.includes("onder witte");

    return isRelevantBlog && textMentionsContext;
  }

  function analyzeInternalLinks(html, candidates) {
    const container = document.createElement("div");
    container.innerHTML = String(html || "");
    const links = Array.from(container.querySelectorAll("a[href]"));
    const cachedRows = getCachedLinkDatabaseRows();
    const bySlug = new Map(
      (cachedRows || [])
        .concat(candidates || [])
        .map((candidate) => [normalizeSlug(candidate.slug), candidate])
    );
    const counts = {
      total: links.length,
      blog: 0,
      category: 0,
      brand: 0,
      other: 0,
      urls: [],
      groups: {
        blog: [],
        category: [],
        brand: [],
        other: [],
      },
    };

    links.forEach((link) => {
      const slug = normalizeSlug(link.getAttribute("href"));
      const candidate = bySlug.get(slug);
      const type = normalizeForSearch(candidate ? candidate.page_type : inferLinkTypeFromSlug(slug));
      counts.urls.push(slug);

      if (type.includes("blog")) {
        counts.blog += 1;
        counts.groups.blog.push(slug);
      } else if (type.includes("categorie")) {
        counts.category += 1;
        counts.groups.category.push(slug);
      } else if (type.includes("merk")) {
        counts.brand += 1;
        counts.groups.brand.push(slug);
      } else {
        counts.other += 1;
        counts.groups.other.push(slug);
      }
    });

    return counts;
  }

  function getCachedLinkDatabaseRows() {
    try {
      const cached = getStoredValue("seoWriterLinkDatabaseCache.v1", "");
      return cached ? JSON.parse(cached) : [];
    } catch (_) {
      return [];
    }
  }

  function inferLinkTypeFromSlug(slug) {
    const clean = normalizeSlug(slug);
    if (!clean) return "overig";
    if (clean.startsWith("/klantenservice") || clean === normalizeSlug(DEFAULT_SETTINGS.waszakjeUrl)) return "overig";
    if (clean.includes("/blog/") || clean.startsWith("/blog/") || clean.startsWith("/nieuws/")) return "blog";
    if (/^\/(lingerie|badmode|nachtmode|kleding|ondergoed)\//.test(clean)) return "categoriepagina";
    if (clean.split("/").filter(Boolean).length === 1) return "merkpagina";
    return "overig";
  }

  function analyzeFirstLastKeyword(result) {
    const keyword = result.keyword || "";
    const paragraphs = extractParagraphTexts([result.introHtml, result.bodyHtml].filter(Boolean).join("\n"));
    return {
      first: paragraphs.length ? countPhrase(paragraphs[0], keyword) > 0 : false,
      last: paragraphs.length ? countPhrase(paragraphs[paragraphs.length - 1], keyword) > 0 : false,
    };
  }

  function extractParagraphTexts(html) {
    const container = document.createElement("div");
    container.innerHTML = String(html || "");
    const paragraphs = Array.from(container.querySelectorAll("p"));
    if (paragraphs.length) return paragraphs.map((p) => cleanWhitespace(p.textContent)).filter(Boolean);
    const text = htmlToPlainText(html);
    return text ? [text] : [];
  }

  function findForbiddenFormulas(text) {
    const normalized = normalizeForSearch(text);
    const formulas = [
      "in de wereld van",
      "ontdek de perfecte",
      "of je nu op zoek bent",
      "in de stijl van",
      "ons blog met advies over",
      "in ons blog met advies over",
      "het blog met advies over",
      "lees je snel",
      "ton sur ton",
      "ton-sur-ton",
    ];

    return formulas.filter((formula) => normalized.includes(normalizeForSearch(formula)));
  }

  function findRepeatedSentenceStarters(sentences) {
    const watched = new Set(["handig"]);
    const counts = new Map();

    sentences.forEach((sentence) => {
      const first = normalizeForSearch(sentence).split(" ").filter(Boolean)[0] || "";
      if (!watched.has(first)) return;
      counts.set(first, (counts.get(first) || 0) + 1);
    });

    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([starter, count]) => `${starter} (${count}x)`);
  }

  function formatSuggestions(suggestions) {
    if (!suggestions.length) return "Geen opvallende aandachtspunten.";
    return `<ul class="seo-analysis-list">${suggestions.map((item) => `
      <li>
        ${escapeHtml(item.message)}
        <button type="button" class="seo-analysis-fix" data-issue="${escapeAttribute(item.code)}" title="Herstel met AI">🤖</button>
      </li>
    `).join("")}</ul>`;
  }

  function getAnalysisSuggestions(context) {
    const suggestions = [];
    if (context.exactKeywordDensity < 1) suggestions.push({ code: "keyword_density_low", message: "Hoofdzoekwoord zit onder 1%. Controleer of dit bewust is." });
    if (context.exactKeywordDensity > 2.3) suggestions.push({ code: "keyword_density_high", message: "Hoofdzoekwoord zit boven 2%. Let op keyword stuffing." });
    if (context.sentenceStats.longest.wordCount > 22) suggestions.push({ code: "long_sentence", message: "Er staat een lange zin in. Inkorten kan de leesbaarheid verbeteren." });
    if (context.h2Count < 2) suggestions.push({ code: "heading_count", message: "Weinig H2-koppen. Extra structuur kan de footercontent sterker maken." });
    if (context.words.length < 250) suggestions.push({ code: "text_too_short", message: "Tekst is vrij kort. Meer uitleg kan extra context en interne links dragen." });
    if (context.linkAnalysis.total < 3) suggestions.push({ code: "internal_links", message: "Er staan weinig interne links in de tekst. Voeg relevante categorie-, merk- of bloglinks toe." });
    if (context.missedLinkOpportunities.length) suggestions.push({ code: "missed_link_opportunities", message: `Er zijn ${context.missedLinkOpportunities.length} mogelijke linkkansen die nog niet gelinkt zijn.` });
    if (context.linkAnalysis.category === 0) suggestions.push({ code: "category_link", message: "Er is nog geen duidelijke categoriepagina gelinkt." });
    if (context.linkAnalysis.brand === 0) suggestions.push({ code: "brand_link", message: "Er is nog geen duidelijke merkpagina gelinkt." });
    if (context.forbiddenFormulas.length) suggestions.push({ code: "forbidden_formulas", message: `Verboden GPT-formules gevonden: ${context.forbiddenFormulas.join(", ")}.` });
    if (context.repeatedStarters.length) suggestions.push({ code: "repeated_starters", message: `Herhalende zinsstarters gevonden: ${context.repeatedStarters.join(", ")}.` });
    if (!context.pageTitleCheck.ok) suggestions.push({ code: "page_title_length", message: `Page title is ${context.pageTitleCheck.length} tekens. Richting is ${DEFAULT_SETTINGS.pageTitleMinLength}-${DEFAULT_SETTINGS.pageTitleMaxLength}.` });
    if (!context.metaDescriptionCheck.ok) suggestions.push({ code: "meta_description_length", message: `Meta description is ${context.metaDescriptionCheck.length} tekens. Maximaal ${DEFAULT_SETTINGS.metaDescriptionMaxLength}.` });
    if (!context.firstLastKeyword.first) suggestions.push({ code: "keyword_first_paragraph", message: "Het hoofdzoekwoord staat niet in de eerste alinea." });
    if (!context.firstLastKeyword.last) suggestions.push({ code: "keyword_last_paragraph", message: "Het hoofdzoekwoord staat niet in de laatste alinea." });
    return suggestions;
  }

  function htmlToPlainText(html) {
    const container = document.createElement("div");
    container.innerHTML = String(html || "")
      .replace(/<\/(p|h[1-6]|li)>/gi, ".$& ")
      .replace(/<br\s*\/?>/gi, " ");
    return cleanWhitespace((container.textContent || "").replace(/\s*\.+\s*\./g, "."));
  }

  function getWords(text) {
    return (normalizeForSearch(text).match(/[a-z0-9]+(?:-[a-z0-9]+)?/g) || []);
  }

  function getSentences(text) {
    return cleanWhitespace(text)
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => cleanWhitespace(sentence))
      .filter(Boolean);
  }

  function getSentenceStats(sentences) {
    const measured = sentences.map((sentence) => ({
      text: sentence,
      wordCount: getWords(sentence).length,
    })).filter((sentence) => sentence.wordCount > 0);

    if (!measured.length) {
      return {
        longest: { text: "", wordCount: 0 },
        shortest: { text: "", wordCount: 0 },
      };
    }

    return {
      longest: measured.reduce((a, b) => (b.wordCount > a.wordCount ? b : a), measured[0]),
      shortest: measured.reduce((a, b) => (b.wordCount < a.wordCount ? b : a), measured[0]),
    };
  }

  function countPhrase(text, phrase) {
    const normalizedText = ` ${normalizeForSearch(text)} `;
    const normalizedPhrase = normalizeForSearch(phrase);
    if (!normalizedPhrase) return 0;

    const pattern = new RegExp(`\\b${escapeRegExp(normalizedPhrase).replace(/\s+/g, "\\s+")}\\b`, "g");
    return (normalizedText.match(pattern) || []).length;
  }

  function getTopNgrams(words, size, limit) {
    const stopwords = getDutchStopwords();
    const counts = new Map();

    for (let i = 0; i <= words.length - size; i += 1) {
      const parts = words.slice(i, i + size);
      if (parts.every((word) => stopwords.has(word))) continue;
      if (parts.some((word) => word.length < 3 && size === 1)) continue;

      const term = parts.join(" ");
      counts.set(term, (counts.get(term) || 0) + 1);
    }

    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([term, count]) => ({
        term,
        count,
        density: words.length ? (count / words.length) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
      .slice(0, limit);
  }

  function getReadability(text, words, sentences) {
    const wordCount = Math.max(1, words.length);
    const sentenceCount = Math.max(1, sentences.length);
    const syllables = Math.max(1, words.reduce((total, word) => total + countDutchSyllables(word), 0));
    const score = 206.84 - (0.93 * (wordCount / sentenceCount)) - (77 * (syllables / wordCount));

    let label = "moeilijk";
    if (score >= 80) label = "zeer makkelijk";
    else if (score >= 70) label = "makkelijk";
    else if (score >= 60) label = "gemiddeld";
    else if (score >= 50) label = "redelijk pittig";

    return { score, label };
  }

  function countDutchSyllables(word) {
    const clean = normalizeForSearch(word).replace(/[^a-z]/g, "");
    if (!clean) return 1;
    const groups = clean.match(/[aeiouy]+/g) || [];
    return Math.max(1, groups.length);
  }

  function getDutchStopwords() {
    return new Set([
      "aan", "als", "bij", "dan", "dat", "de", "die", "dit", "een", "en", "er", "het", "in", "is", "je", "met", "niet", "of", "om", "op", "te", "van", "voor", "wat", "we", "ze", "zijn",
      "ook", "naar", "door", "uit", "over", "maar", "meer", "wel", "kan", "kun", "jouw", "onze", "deze", "die", "daar", "hier",
    ]);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function fillCmsFields(result) {
    const missing = [];

    if (result.pageType !== "product") {
      setFieldValue(SELECTORS.pageTitle, result.pageTitle, missing);
      setFieldValue(SELECTORS.headerTitle, result.headerTitle, missing);
    }
    setFieldValue(SELECTORS.description, result.metaDescription, missing);
    setFieldValue(SELECTORS.keywords, result.keywords, missing);

    const contentTargets = getContentTargets();
    if ((result.pageType === "collectie" || result.pageType === "product") && contentTargets.main) {
      if (!setTinyMceContent(contentTargets.main, result.contentHtml)) {
        setSpecificFieldValue(contentTargets.main, result.contentHtml);
      }
    } else if (contentTargets.main && contentTargets.footer) {
      if (!setTinyMceContent(contentTargets.main, result.introHtml)) {
        setSpecificFieldValue(contentTargets.main, result.introHtml);
      }

      if (!setTinyMceContent(contentTargets.footer, result.bodyHtml)) {
        setSpecificFieldValue(contentTargets.footer, result.bodyHtml);
      }
    } else if (contentTargets.main) {
      if (!setTinyMceContent(contentTargets.main, result.contentHtml)) {
        setSpecificFieldValue(contentTargets.main, result.contentHtml);
      }
      missing.push("Footer content");
    } else {
      missing.push(SELECTORS.content);
    }

    const sidebarUpdated = result.pageType === "collectie" ? setShowInSidebarYes() : false;
    const status = document.getElementById("seo-writer-status");
    const filledTargets = [
      contentTargets.main ? describeField(contentTargets.main) : null,
      contentTargets.footer ? describeField(contentTargets.footer) : null,
    ].filter(Boolean);
    const sidebarText = sidebarUpdated ? " Sidebar op Yes gezet." : "";
    status.textContent = missing.length
      ? `Ingevuld, maar niet gevonden: ${missing.join(", ")}. Velden: ${filledTargets.join(" / ")}.${sidebarText}`
      : `SEO-velden ingevuld. Velden: ${filledTargets.join(" / ")}.${sidebarText}`;

    renderSeoAnalysis(result);
  }

  function setShowInSidebarYes() {
    const yes = document.querySelector(SELECTORS.showInSidebarYes);
    if (!yes) return false;
    if (yes.checked) return false;

    yes.checked = true;
    yes.dispatchEvent(new Event("input", { bubbles: true }));
    yes.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setFieldValue(selector, value, missing) {
    const field = document.querySelector(selector);
    if (!field) {
      missing.push(selector);
      return false;
    }

    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setSpecificFieldValue(field, value) {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getContentTargets() {
    if (getDetectedPageType() === "product") {
      return { main: getProductDescriptionField(), footer: null };
    }

    const mainByName = findTextareaByExactName("content") || document.querySelector(SELECTORS.content);
    const footerByName =
      findTextareaByExactName("meta[nl][footer_content]") ||
      findTextareaByExactName("footer_content") ||
      document.querySelector(SELECTORS.footerContent);
    const mainByLabel = findTextareaByControlLabel("Content");
    const footerByLabel = findTextareaByControlLabel("Footer content") || findTextareaByControlLabel("Footer");
    const editors = Array.from(document.querySelectorAll("textarea.htmleditor"));

    const main = mainByName || mainByLabel || editors[0] || null;
    const footer = footerByName || footerByLabel || editors.find((field) => field !== main) || null;

    return { main, footer };
  }

  function findTextareaByExactName(name) {
    return Array.from(document.querySelectorAll("textarea")).find((field) => field.getAttribute("name") === name) || null;
  }

  function describeField(field) {
    const name = field.getAttribute("name") || "zonder name";
    const id = field.id || "zonder id";
    return `${name} (${id})`;
  }

  function findTextareaByControlLabel(labelText) {
    const normalizedNeedle = normalizeLabel(labelText);
    const labels = Array.from(document.querySelectorAll("td.control, th.control, label"));

    for (const label of labels) {
      if (normalizeLabel(label.textContent) !== normalizedNeedle) continue;

      const row = label.closest("tr");
      const textareaInRow = row && row.querySelector("textarea");
      if (textareaInRow) return textareaInRow;

      const nextCell = label.nextElementSibling;
      const textareaInNextCell = nextCell && nextCell.querySelector("textarea");
      if (textareaInNextCell) return textareaInNextCell;
    }

    return null;
  }

  function normalizeLabel(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/:$/, "")
      .trim()
      .toLowerCase();
  }

  function setTinyMceContent(textarea, html) {
    const editorId = textarea && textarea.id ? textarea.id : "mce_0";
    const tiny = window.tinyMCE || window.tinymce;

    if (tiny) {
      const editor = getTinyMceEditor(tiny, editorId);
      if (editor && typeof editor.setContent === "function") {
        editor.setContent(html);
        if (typeof editor.save === "function") editor.save();
        if (textarea) setSpecificFieldValue(textarea, html);
        return true;
      }
    }

    const iframe = document.getElementById(`${editorId}_ifr`);
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      iframe.contentDocument.body.innerHTML = html;
      if (textarea) textarea.value = html;
      return true;
    }

    return false;
  }

  function getTinyMceEditor(tiny, editorId) {
    if (!tiny) return null;

    if (typeof tiny.get === "function") {
      const editor = tiny.get(editorId);
      if (editor) return editor;
    }

    if (typeof tiny.getInstanceById === "function") {
      const editor = tiny.getInstanceById(editorId);
      if (editor) return editor;
    }

    if (tiny.editors && typeof tiny.editors === "object") {
      if (tiny.editors[editorId]) return tiny.editors[editorId];
      const editors = Array.isArray(tiny.editors) ? tiny.editors : Object.values(tiny.editors);
      return editors.find((editor) => editor && editor.id === editorId) || null;
    }

    return null;
  }

  function showPreview(result) {
    const preview = [
      `Page title: ${result.pageTitle}`,
      `Header title: ${result.headerTitle}`,
      `Meta description: ${result.metaDescription}`,
      `Meta keywords: ${result.keywords}`,
      "",
      result.contentHtml,
    ].join("\n");

    const popup = window.open("", "seoWriterPreview", "width=720,height=760,scrollbars=yes");
    if (!popup) {
      document.getElementById("seo-writer-status").textContent = "Preview kon niet worden geopend.";
      return;
    }

    popup.document.open();
    popup.document.write(`<!doctype html><html><head><title>SEO preview</title><style>body{font:14px/1.55 Arial,sans-serif;max-width:760px;margin:24px auto;color:#1f2933;}pre{white-space:pre-wrap;background:#f4f7fb;padding:14px;border:1px solid #d7dee8;}</style></head><body><pre>${escapeHtml(preview)}</pre><hr>${result.contentHtml}</body></html>`);
    popup.document.close();
  }

  function clampSentence(text, maxLength) {
    if (text.length <= maxLength) return text;
    const shortened = text.slice(0, maxLength + 1).replace(/\s+\S*$/, "").trim();
    return shortened.replace(/[|,.;:-]+$/, "");
  }

  function sentenceCase(text) {
    const clean = cleanWhitespace(text);
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  function cleanWhitespace(text) {
    return String(text || "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
  }

  function joinReadable(items) {
    if (items.length <= 1) return items[0] || "";
    if (items.length === 2) return `${items[0]} en ${items[1]}`;
    return `${items.slice(0, -1).join(", ")} en ${items[items.length - 1]}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function getStoredValue(key, fallback) {
    if (typeof GM_getValue === "function") {
      return GM_getValue(key, fallback);
    }

    return window.localStorage.getItem(key) || fallback;
  }

  function setStoredValue(key, value) {
    if (typeof GM_setValue === "function") {
      GM_setValue(key, value);
      return;
    }

    window.localStorage.setItem(key, value);
  }

  addStyles();
  createPanel();
})();
