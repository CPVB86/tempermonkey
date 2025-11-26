// ==UserScript==
// @name         Sparkle | HOM
// @version      1.0
// @description  Klikbare ✨ achter het prijsblok om HTML voor DDO te genereren
// @match        https://b2b.huberholding.com/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-hom.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-hom.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Helpers ---
    const $ = (sel, root=document) => root.querySelector(sel);
    const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
    const txt = (sel, root=document) => $(sel, root)?.textContent.trim() || '';

    // Veiliger selecteren met starts/ends-with zodat index (_0) geen probleem is
    const byIdLike = (starts, ends) => document.querySelector([id^="${starts}"][id$="${ends}"]);

    const capWords = (s) => s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));

    function parsePriceToEuro(str) {
        // '49.95 ' -> '49.95'
        return (str || '').replace(/[^\d.,]/g,'').replace(',', '.').trim();
    }

    // Voorraad: haal uit 'immediately available 17' het getal (17)
    function availabilityToStock(value) {
        const n = Number(String(value).match(/\d+/)?.[0] || 0);
        if (n >= 50) return 2;
        if (n >= 1) return 1;
        return 0; // 0 -> rij overslaan
    }

    function buildMatrix() {
        // Elk size-card bevat een .gridSize en in de buurt een .gridAvailTxt
        const cards = $$('.color-size-grid > div[id*="_divOID_"]');
        const rows = [];

        for (const card of cards) {
            const size = txt('.gridSize', card);
            // zoek availability label binnen hetzelfde card
            const availTxt = txt('.gridAvailTxt', card);
            const stock = availabilityToStock(availTxt);
            if (!size || stock === 0) continue;
            rows.push(`<tr><td>${size}</td><td></td><td>${stock}</td></tr>`);
        }

        if (!rows.length) return '';

        return `<div class="pdp-details_matrix"><table>${rows.join('')}</table></div>`;
    }

    function getData() {
        // ArticleNo & ColorNr & ColorName
        const articleNo = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_lblArticleNo_0')?.textContent.trim() || '';
        const colorNr = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_lblColorNr_0')?.textContent.trim() || '';
        const colorName = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_lblColorName_0')?.textContent.trim() || '';

        // Type & Model
        const type = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_repDescriptions_0_lblDescValue_0')?.textContent.trim() || '';
        const model = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_repDescriptions_0_lblDescValue_1')?.textContent.trim() || '';

        // RRP
        const rrpRaw = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_lblMinPriceVk_0')?.textContent || '';
        const rrp = parsePriceToEuro(rrpRaw);

        // Product title: "$modelnaam $type $kleurnaam"
        const title = capWords(${model} ${type} ${colorName}.trim());

        // Supplier/Product code: "ArticleNo-ColorNr"
        const productCode = [articleNo, colorNr].filter(Boolean).join('-');

        return { articleNo, colorNr, colorName, type, model, rrp, title, productCode };
    }

    function buildHTML() {
        const { model, rrp, title, productCode } = getData();
        const matrixHTML = buildMatrix();

        return [
            '<!-- HOM EXPORT START -->',
            '<div class="pdp-details">',
            `<h1 class="pdp-details_heading">${title}</h1>`,
            '  <div class="pdp-details_price">',
            `    <span class="pdp-details_price__offer">€ ${rrp}</span>`,
            '  </div>',
            `<div class="pdp-details_product-code">Product Code: <span>${productCode}</span></div>`,
            `<div class="pdp-details_model">Model: <span>${model}</span></div>`,
            '  <a href="#" style="display:none;">extern</a>',
            matrixHTML,
            '</div>',
            '<!-- HOM EXPORT END -->'
        ].join('\n');
    }

    function insertSparkle() {
        // Plaats ✨ bij het VK-prijsblok (RRP)
        const priceContainer = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_divPricesVk_0') ||
                               byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_divColorPrices_0');
        if (!priceContainer || $('.copy-sparkle-hom')) return;

        const sparkle = document.createElement('span');
        sparkle.textContent = ' ✨';
        sparkle.className = 'copy-sparkle-hom';
        sparkle.style.cursor = 'pointer';
        sparkle.style.color = '#0073aa';
        sparkle.style.fontSize = '14px';

        sparkle.addEventListener('click', () => {
            const html = buildHTML();
            navigator.clipboard.writeText(html).then(() => {
                console.log('✅ HOM Sparkle geëxporteerd.');
            }).catch(err => {
                console.error('❌ Fout bij kopiëren:', err);
            });
        });

        priceContainer.appendChild(sparkle);
    }

    const obs = new MutationObserver(() => insertSparkle());
    obs.observe(document.body, { childList: true, subtree: true });

    insertSparkle();
})();
