// ==UserScript==
// @name         DDO SEO Tekst Generator
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      1.0
// @description  Genereert SEO-velden en HTML-content op basis van zoekwoord en longtails.
// @author       Codex
// @match        https://www.dutchdesignersoutlet.com/*
// @match        http://www.dutchdesignersoutlet.com/*
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
    ],
    pageTitleMaxLength: 60,
    metaDescriptionMaxLength: 155,
    introWordTarget: 80,
    paragraphWordMin: 60,
    paragraphWordMax: 75,
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
        width: 390px;
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
          <span>SEO tekst generator</span>
          <button type="button" class="seo-writer-close" title="Sluiten">x</button>
        </div>
        <div class="seo-writer-body">
          <label for="seo-writer-input">Zoekwoord | longtail(s)</label>
          <textarea id="seo-writer-input" placeholder="Voorbeeld: cupmaat 80C | bh maat 80C, balconette bh 80C, lingerie 80C"></textarea>
          <div class="seo-writer-help">Plak gerust met tab tussen zoekwoord en longtails; het veld toont dat als |.</div>
          <div class="seo-writer-row">
            <div>
              <label for="seo-writer-page-type">Paginatype</label>
              <select id="seo-writer-page-type">
                <option value="categoriepagina" selected>Categoriepagina</option>
                <option value="landingspagina">Landingspagina</option>
                <option value="blog">Blog</option>
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
          <label for="seo-writer-tone">Extra instructies</label>
          <input id="seo-writer-tone" type="text" placeholder="Bijv. luchtiger, meer advies, specifieker voor badmode">
          <label for="seo-writer-api-key">OpenAI API key</label>
          <input id="seo-writer-api-key" type="password" placeholder="sk-..." value="${escapeAttribute(getStoredValue("seoWriterApiKey", ""))}">
          <div class="seo-writer-actions">
            <button type="button" id="seo-writer-fill">Genereer met API</button>
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
      showPreview(result);
    });

    document.getElementById("seo-writer-input").addEventListener("input", (event) => {
      normalizeVisibleSeparator(event.target);
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
    status.textContent = "Linkdatabase wordt opgehaald...";

    try {
      request.linkCandidates = await getRankedLinkCandidates(request);
      status.textContent = request.linkCandidates.length
        ? `Tekst wordt gegenereerd met ${request.linkCandidates.length} linkkandidaten...`
        : "Tekst wordt gegenereerd zonder automatische linkkandidaten...";
      const apiResult = await callOpenAiSeoGenerator(request);
      status.textContent = "API-tekst ontvangen; velden worden ingevuld.";
      return normalizeApiResult(apiResult, request.keyword, request.longtails);
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
    return generateSeoText(request.keyword, request.longtails, request.extraInstruction);
  }

  function getSeoRequestInput() {
    const status = document.getElementById("seo-writer-status");
    const rawInput = document.getElementById("seo-writer-input").value.trim();
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
      internalLinks: document.getElementById("seo-writer-links").value.trim(),
      extraInstruction: document.getElementById("seo-writer-tone").value.trim(),
      apiKey: document.getElementById("seo-writer-api-key").value.trim(),
      model: document.getElementById("seo-writer-model").value.trim() || DEFAULT_SETTINGS.model,
    };
  }

  function getPageSlug() {
    const readonlyInputs = Array.from(document.querySelectorAll('input[readonly], input[readonly="readonly"]'));
    const slugField = readonlyInputs.find((field) => {
      const value = cleanWhitespace(field.value);
      return value.startsWith("/") && !value.includes(" ");
    });

    return slugField ? cleanWhitespace(slugField.value) : "";
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
      "Gebruik het hoofdzoekwoord in 60-75% van de H2-koppen.",
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
      "Als een H2 of alinea een duidelijk producttype noemt, zoals push up bh, T-shirt bh, balconette bh of strapless bh, link dan naar de passende categoriepagina als die kandidaat beschikbaar is.",
      "Als een kop bijvoorbeeld 'blauwe push up bh en andere vormen' heet en de alinea push up bh inhoudelijk bespreekt, verdient die eerste natuurlijke vermelding een interne link naar de push up bh categorie.",
      "Als er een relevante blogkandidaat beschikbaar is, verwerk dan minstens een bloglink.",
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
      "Schrijf niet 'advies over' vlak voor een bloganchor, tenzij de echte blogtitel dat letterlijk bevat.",
      "Begin blogverwijzingen liever met een werkwoord of concrete aanleiding, zoals 'Lees', 'Bekijk', 'Twijfel je tussen modellen, lees dan', of 'Wil je meer houvast, bekijk dan'.",
      "Verwerk de blogtitel of anchor als natuurlijk onderdeel van de zin en zet de gelinkte bloganchor eventueel tussen <em>...</em>.",
      "Gebruik nooit markdown-asterisks voor cursieve tekst. Gebruik uitsluitend <em>...</em> als iets schuin moet staan.",
      "De enige uitzondering op asterisks is de exacte dynamische verzendwaarde: €**ORDER_PRICE_FREE_SHIPPING**. Laat deze exact zo staan, inclusief dubbele asterisks.",
      "Als klantenservice relevant ter sprake komt, link dan naar <a href=\"/klantenservice/contact\">klantenservice</a>.",
      "Als verzending relevant ter sprake komt, mag je benoemen: verzendkostenvrij vanaf €**ORDER_PRICE_FREE_SHIPPING**.",
      "Als passen of maatadvies relevant ter sprake komt, mag je benoemen dat een pasafspraak kan met lingerie expert Monique, badmode expert Monique of lingerie én badmode expert Monique via <a href=\"/klantenservice/pas-afspraak\">een pasafspraak</a>. Kies de expertise op basis van de pagina-inhoud.",
      "Gebruik op categoriepagina's en merkpagina's bij voorkeur minstens een relevante bloglink als er een echt passende blogkandidaat beschikbaar is.",
      "Benoemde merken mogen gelinkt worden als de linkkandidaat precies bij dat merk past.",
      "Benoemde bh-modellen en producttypen mogen gelinkt worden als er een exacte of zeer passende kandidaat is, bijvoorbeeld T-shirt bh, balconette bh, push up bh of strapless bh.",
      "Voorkom linkclusters, maar wees niet te zuinig. Plaats liever niet meer dan twee interne links in een korte alinea, tenzij drie merken of producttypes inhoudelijk echt naast elkaar worden vergeleken.",
      "Geef uitsluitend geldige JSON terug volgens het schema.",
    ].join("\n");
  }

  function buildApiInput(request) {
    const automaticLinks = formatLinkCandidatesForPrompt(request.linkCandidates || []);

    return [
      `Hoofdzoekwoord: ${request.keyword}`,
      `Longtails: ${request.longtails.join(", ") || "geen"}`,
      `Paginatype: ${request.pageType}`,
      `URL/slug: ${request.url || "niet opgegeven"}`,
      `Handmatig opgegeven interne links: ${request.internalLinks || "geen"}`,
      `Automatisch geselecteerde interne linkkandidaten uit de linkdatabase:`,
      automaticLinks || "geen",
      `Extra instructies: ${request.extraInstruction || "geen"}`,
      "",
      "Schrijf een unieke tekst voor deze pagina.",
      "Zorg dat intro_html alleen de eerste alinea bevat.",
      "Zorg dat body_html alle footer content bevat, dus de H2-koppen en verdere alinea's.",
      "Kies alleen links uit de handmatig opgegeven links of automatische linkkandidaten.",
      `Gebruik maximaal ${DEFAULT_SETTINGS.maxLinksInText} interne links totaal.`,
      "Streef naar een natuurlijke mix van categoriepagina, merkpagina en bloglink als die kandidaten relevant zijn.",
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

  function normalizeApiResult(apiResult, keyword, longtails) {
    const introHtml = polishBlogReferences(normalizeEmphasis(autoLinkWaszakje(apiResult.intro_html || buildIntroParagraph(keyword, longtails))));
    const bodyHtml = polishBlogReferences(normalizeEmphasis(autoLinkWaszakje(sanitizeHeadingColons(apiResult.body_html || ""))));

    return {
      pageTitle: sanitizeSeoLine(apiResult.page_title || buildPageTitle(keyword, longtails)),
      headerTitle: sanitizeSeoLine(apiResult.header_title || `${sentenceCase(keyword)} kopen`),
      metaDescription: sanitizeSeoLine(apiResult.meta_description || ""),
      keywords: apiResult.meta_keywords || [keyword].concat(longtails).join(", "),
      introHtml,
      bodyHtml,
      contentHtml: [introHtml, bodyHtml].filter(Boolean).join("\n"),
      seoCheck: apiResult.seo_check || null,
    };
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
        .sort((a, b) => b.score - a.score || Number(a.link_priority || 9) - Number(b.link_priority || 9))
        .slice(0, DEFAULT_SETTINGS.maxLinkCandidates);

      return candidates;
    } catch (error) {
      console.warn("[SEO writer] Linkdatabase kon niet worden geladen:", error);
      const status = document.getElementById("seo-writer-status");
      if (status) status.textContent = `Linkdatabase overgeslagen: ${error.message}`;
      return [];
    }
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
    const queryPhrases = [request.keyword]
      .concat(request.longtails || [])
      .concat(DEFAULT_SETTINGS.contextualLinkTerms)
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

    queryPhrases.forEach((phrase, index) => {
      if (!phrase) return;
      if (searchable.includes(phrase)) score += index === 0 ? 14 : 9;
    });

    queryTokens.forEach((token) => {
      if (tagTokens.includes(token)) score += 4;
      else if (searchable.includes(token)) score += 1.5;
    });

    if (row.audience_intent === "sale" && !searchable.includes("sale")) score -= 1;
    if (row.link_priority === 3 && score < 18) return 0;

    return score;
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
    const stopwords = new Set(["voor", "met", "zonder", "een", "het", "de", "en", "van", "bij", "sale"]);
    return Array.from(new Set(normalizeForSearch(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !stopwords.has(token))));
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

  function fillCmsFields(result) {
    const missing = [];

    setFieldValue(SELECTORS.pageTitle, result.pageTitle, missing);
    setFieldValue(SELECTORS.headerTitle, result.headerTitle, missing);
    setFieldValue(SELECTORS.description, result.metaDescription, missing);
    setFieldValue(SELECTORS.keywords, result.keywords, missing);

    const contentTargets = getContentTargets();
    if (contentTargets.main && contentTargets.footer) {
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

    const status = document.getElementById("seo-writer-status");
    const filledTargets = [
      contentTargets.main ? describeField(contentTargets.main) : null,
      contentTargets.footer ? describeField(contentTargets.footer) : null,
    ].filter(Boolean);
    status.textContent = missing.length
      ? `Ingevuld, maar niet gevonden: ${missing.join(", ")}. Velden: ${filledTargets.join(" / ")}.`
      : `SEO-velden ingevuld. Velden: ${filledTargets.join(" / ")}.`;
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
