// ==UserScript==
// @name         Lisca PDP Sparkle
// @version      2.1.5
// @description  Voeg een klikbare ✨ toe onder de h1 om de relevante product-info HTML te kopiëren voor DDO
// @match        https://b2b-eu.lisca.com/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/lisca-pdp-sparkle.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/lisca-pdp-sparkle.user.js
// ==/UserScript==

(function () {
    'use strict';

    function insertLiscaCopyButton() {
        const heading = document.querySelector('.page-title-wrapper h1');
        if (!heading || document.querySelector('.copy-sparkle')) return;

        const copyBtn = document.createElement('h5');
        copyBtn.textContent = '✨';
        copyBtn.className = 'copy-sparkle';
        copyBtn.style.cursor = 'pointer';
        copyBtn.style.marginTop = '5px';
        copyBtn.style.fontWeight = 'normal';
        copyBtn.style.fontSize = '14px';
        copyBtn.style.color = '#0073aa';

        copyBtn.addEventListener('click', function (e) {
            e.stopPropagation();

            setTimeout(() => {
                const h1Text = document.querySelector('.page-title-wrapper .base')?.textContent.trim() || '';

                // Probeer modelnaam uit lisca-produc-id
                const rawModelLine = document.querySelector('.lisca-produc-id')?.textContent.trim() || '';
                const modelMatch = rawModelLine.match(/^([^\-\n]+)/);
                const modelRaw = modelMatch ? modelMatch[1].trim() : '';

                // Modelnaam normaliseren
                const model = modelRaw
                    .replace(/[»«]/g, '')
                    .toLowerCase()
                    .replace(/\b\w/g, c => c.toUpperCase());

                // Verwijder modelnaam en rare tekens uit h1 tekst
                const titlePart = h1Text.replace(/[»«]/g, '').replace(new RegExp(modelRaw, 'i'), '').trim();
                const titleClean = titlePart.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

                // Voeg kleur toe aan titel
                const kleurRaw = document.querySelector('.related-list-selected-option')?.textContent.trim() || '';
                const kleurClean = kleurRaw.replace(/^[^\-]+\s*-\s*/, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

                // Combineer model + titel + kleur
                const title = `${model} ${titleClean} ${kleurClean}`.trim();

                const form = document.querySelector('.product-add-form form');
                let sku = form?.getAttribute('data-product-sku') || '';
                if (sku.length > 6) {
                    sku = sku.slice(0, 6) + '-' + sku.slice(6);
                }

                let priceEl = document.querySelector('.product-info-price .old-price .price');
                if (!priceEl) {
                    priceEl = document.querySelector('.product-info-price .price-final_price .price');
                }

                const rawPrice = priceEl?.textContent.replace(/[^\d,]/g, '').replace(',', '.') || '0';
                const parsedPrice = parseFloat(rawPrice);

                let verkoopPrijs = '0,00';
                if (!isNaN(parsedPrice)) {
                    verkoopPrijs = (parsedPrice * 2.5).toFixed(2).replace('.', ',');
                }

                const matrix = document.querySelector('#product-options-wrapper .prodmatrix-type1');
                const matrixHTML = matrix ? `\n<div class="pdp-details_matrix">${matrix.outerHTML}</div>` : '';

                const html = `<!-- LISCA EXPORT START -->\n` +
`<div class="pdp-details">\n` +
`  <h1 class="pdp-details_heading">${title}</h1>\n` +
`  <div class="pdp-details_price">\n` +
`    <span class="pdp-details_price__offer">€ ${verkoopPrijs}</span>\n` +
`  </div>\n` +
`  <div class="pdp-details_product-code">Product Code: <span>${sku}</span></div>\n` +
`  <div class="pdp-details_model">Model: <span>${model}</span></div>\n` +
`  <a href="#" style="display:none;">extern</a>\n` +
`${matrixHTML}\n` +
`</div>\n` +
`<!-- LISCA EXPORT END -->`;

                navigator.clipboard.writeText(html).then(() => {
                    console.log(`✅ Geëxporteerd: ${title} | ${sku} | € ${verkoopPrijs}`);
                }).catch(err => {
                    console.error('❌ Fout bij kopiëren:', err);
                });

            }, 500);
        });

        heading.insertAdjacentElement('afterend', copyBtn);
    }

    const observer = new MutationObserver(() => {
        insertLiscaCopyButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    insertLiscaCopyButton();
})();
