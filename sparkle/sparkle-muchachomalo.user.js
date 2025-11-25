// ==UserScript==
// @name         Sparkle | Muchachomalo
// @version      1
// @description  Voeg een klikbare ✨ toe onder de h1 om de relevante product-info HTML te kopiëren voor DDO
// @match        https://agent.muchachomalo.com/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-muchachomalo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-muchachomalo.user.js
// ==/UserScript==

(function () {
    'use strict';

    function extractPageSlug() {
        const path = window.location.pathname;
        const match = path.match(/\/en\/([^/]+)/i);
        return match ? match[1].toLowerCase() : '';
    }

    function extractSupplierPIDFromCarousel() {
        const pageSlug = extractPageSlug();
        const imgs = document.querySelectorAll('#imagesContainer .slick-track img');
        for (const img of imgs) {
            const src = img.getAttribute('src') || '';
            const match = src.match(/\/([a-z0-9\-]{6,})\.(png|jpg)/i);
            if (match) {
                const candidate = match[1]; // bijv. fruitnoevil1010-04
                const normalized = candidate.replace(/-/g, '').toLowerCase(); // fruitnoevil101004
                if (pageSlug.includes(normalized)) {
                    return candidate;
                }
            }
        }
        console.warn('⚠️ Geen match gevonden tussen slug en afbeelding');
        return '';
    }

function extractModelName(supplierPID) {
    const rawTitle = document.querySelector('.articletitle')?.textContent.trim() || '';
    if (!rawTitle || !supplierPID) return '';

    // Titel omzetten naar losse woorden vanaf rechts
    const titleWords = rawTitle.split(/\s+/);

    // Normaliseer supplierPID zonder cijfers en koppeltekens
    const pidAlpha = supplierPID.toLowerCase().replace(/[^a-z]/g, '');

    // Loop van rechts naar links over de titelwoorden
    let modelWords = [];
    for (let i = titleWords.length - 1; i >= 0; i--) {
        modelWords.unshift(titleWords[i]);
        const testCombo = modelWords.join('').toLowerCase().replace(/[^a-z]/g, '');
        if (pidAlpha.startsWith(testCombo)) {
            return modelWords.join(' ');
        }
    }

    return ''; // niets gevonden
}


    function extractTitle() {
        const title = document.querySelector('.articletitle')?.textContent.trim() || '';
        return title;
    }

    function extractPrice() {
        const rrp = [...document.querySelectorAll('th')].find(th => th.textContent.includes('RRP:'));
        const td = rrp?.nextElementSibling;
        const prijs = td?.textContent.replace(/[^\d,\.]/g, '').replace(',', '.') || '';
        return prijs;
    }

    function extractMatrixHTML() {
        const matrix = document.querySelector('#stockcontainer table');
        if (!matrix) return '';
        const rows = [...matrix.querySelectorAll('tr')].slice(1); // skip header
        let html = '<div class="pdp-details_matrix"><table>';
        for (const row of rows) {
            const cols = row.querySelectorAll('td');
            if (cols.length >= 3) {
                const maat = cols[0].textContent.trim();
                const ean = cols[1].textContent.trim();
                const voorraad = parseInt(cols[2].textContent.trim(), 10);
                const stock = isNaN(voorraad) ? 0 : voorraad < 5 ? 1 : 2;
                html += `<tr><td>${maat}</td><td>${ean}</td><td>${stock}</td></tr>`;
            }
        }
        html += '</table></div>';
        return html;
    }

    function insertSparkleButton() {
        const target = document.querySelector('h1.category');
        if (!target || document.querySelector('.copy-sparkle')) return;

        const btn = document.createElement('span');
        btn.textContent = ' ✨';
        btn.className = 'copy-sparkle';
        btn.style.cursor = 'pointer';
        btn.style.color = '#0073aa';
        btn.style.fontWeight = 'normal';
        btn.style.fontSize = '14px';

        btn.addEventListener('click', () => {
            const supplierPID = extractSupplierPIDFromCarousel();
            const model = extractModelName(supplierPID);
            const title = extractTitle();
            const verkoopPrijs = extractPrice();
            const matrixHTML = extractMatrixHTML();

            const html = `<!-- MUCHACHOMALO EXPORT START -->\n` +
                `<div class="pdp-details">\n` +
                `  <h1 class="pdp-details_heading">${title}</h1>\n` +
                `  <div class="pdp-details_price">\n` +
                `    <span class="pdp-details_price__offer">€ ${verkoopPrijs}</span>\n` +
                `  </div>\n` +
                `  <div class="pdp-details_product-code">Product Code: <span>${supplierPID}</span></div>\n` +
                `  <div class="pdp-details_model">Model: <span>${model}</span></div>\n` +
                `  <a href="#" style="display:none;">extern</a>\n` +
                `${matrixHTML}\n` +
                `</div>\n` +
                `<!-- MUCHACHOMALO EXPORT END -->`;

            navigator.clipboard.writeText(html).then(() => {
                console.log(`✅ Geëxporteerd: ${title} | ${supplierPID} | € ${verkoopPrijs}`);
            }).catch(err => {
                console.error('❌ Fout bij kopiëren:', err);
            });
        });

        target.appendChild(btn);
    }

    const observer = new MutationObserver(() => {
        insertSparkleButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    insertSparkleButton();
})();
