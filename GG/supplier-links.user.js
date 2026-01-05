// ==UserScript==
// @name         GG | Supplier-links.user.js
// @namespace    https://dutchdesignersoutlet.nl/
// @version      0.8
// @description  Voeg leveranciers-links toe voor [ext]-producten in Goedgepickt orderscherm
// @author       You
// @match        https://fm-e-warehousing.goedgepickt.nl/orders/view/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/supplier-links.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/supplier-links.user.js
// ==/UserScript==

(function () {
    'use strict';

    function normalizeText(text) {
        return text ? text.replace(/\s+/g, ' ').trim() : '';
    }

    function getBaseUrl(productName) {
        const name = productName.toLowerCase();

        if (/wacoal|freya|fantasie|elomi/.test(name)) {
            return 'https://b2b.wacoal-europe.com/b2b/en/EUR/search/?text=';
        }
        if (/lisca/.test(name)) {
            return 'https://b2b-eu.lisca.com/catalogsearch/result/?q=';
        }
        if (/triumph/.test(name)) {
            return 'https://b2b.triumph.com/products/NL_TriumphPROD?search=';
        }
        if (/sloggi/.test(name)) {
            return 'https://b2b.triumph.com/products/NL_sloggiPROD?search=';
        }
        if (/lingadore/.test(name)) {
            return 'https://b2b.lingadore.com/nl/catalog/item/';
        }
        if (/sugar\s*candy/.test(name)) {
            return 'https://b2b.cakelingerie.eu/search?controller=search&s=';
        }
        if (/muchachomalo|chicamala/.test(name)) {
            return 'https://agent.muchachomalo.com/en/search?keyword=';
        }
        if (/mundo\s+unico/.test(name)) {
            return 'https://www.colomoda.eu/search/';
        }
        if (/charlie\s+choe/.test(name)) {
            return 'https://vangennip.itsperfect.it/webshop/search/';
        }
        if (/pastunette|rebelle|robson/.test(name)) {
            return 'https://b2b.zetex.nl/webstore/v2/search?q=';
        }
        if (/ringella/.test(name)) {
            return 'https://b2b.ringella.com/ItemView.action?number=';
        }

        return null;
    }

    function getSupplierId(productName) {
        const text = normalizeText(productName);
        const marker = ' - [ext]';

        const markerIndex = text.indexOf(marker);
        if (markerIndex === -1) return null;

        const beforeMarker = text.slice(0, markerIndex).trim();
        const lastDash = beforeMarker.lastIndexOf(' - ');
        if (lastDash === -1) return null;

        const supplier = beforeMarker.slice(lastDash + 3).trim();
        return supplier || null;
    }

    function addSupplierLinkToRow(row) {
        if (row.querySelector('.gg-order-me-ext-link')) return;

        const productAnchor = row.querySelector('td[data-field="picture"] a[data-product-uuid]');
        if (!productAnchor) return;

        const productName = normalizeText(productAnchor.textContent);
        if (!productName.includes('[ext]')) return;

        let supplierId = getSupplierId(productName);
        if (!supplierId) return;

        const baseUrl = getBaseUrl(productName);
        if (!baseUrl) return;

        const lowerName = productName.toLowerCase();

        // Speciale handling voor Charlie Choe:
        // O57145-38-F11-31803 -> O57145-38
        if (/charlie\s+choe/.test(lowerName)) {
            const parts = supplierId.split('-');
            if (parts.length >= 2) {
                supplierId = parts[0] + '-' + parts[1];
            }
        }

        // Speciale handling voor Lisca:
        // 20137-1 / 20137-1-123 -> 20137 (eerste blok vóór eerste streepje)
        if (/lisca/.test(lowerName)) {
            supplierId = supplierId.split('-')[0].trim();
        }

        const link = document.createElement('a');
        link.href = baseUrl + encodeURIComponent(supplierId);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = ' 🔗';
        link.title = 'Open leverancier (' + supplierId + ')';
        link.className = 'gg-order-me-ext-link';
        link.style.marginLeft = '0.25em';

        productAnchor.insertAdjacentElement('afterend', link);
    }

    function init() {
        const rows = document.querySelectorAll('tr.normal');
        rows.forEach(addSupplierLinkToRow);
    }

    init();
})();
