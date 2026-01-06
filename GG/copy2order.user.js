// ==UserScript==
// @name         GG | Copy2Order
// @namespace    https://www.lingerieoutlet.nl
// @version      1.6
// @description  TSV kopieerknop voor [ext] + 00. Extern — disabled als er geen matches zijn 😇
// @match        https://fm-e-warehousing.goedgepickt.nl/orders/view/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/copy2order.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/copy2order.user.js
// ==/UserScript==

(function () {
    'use strict';

    function getOrderId() {
        const titleSpans = document.querySelectorAll('.m-subheader .page_title span');
        for (const span of titleSpans) {
            const txt = span.textContent.trim();
            if (/Bestelling/i.test(txt)) {
                const m = txt.match(/Bestelling\s+(\d+)/i);
                if (m) return m[1];
            }
        }
        return '';
    }

    function getOrderUuid() {
        const m = location.pathname.match(/\/orders\/view\/([^\/?#]+)/);
        return m ? m[1] : '';
    }

    function findPickingHeader() {
        const headers = document.querySelectorAll('.m-portlet__head-text');
        for (const el of headers) {
            if (el.textContent.includes('Te picken producten')) return el;
        }
        return null;
    }

    function collectMatches() {
        const orderId = getOrderId();
        const orderUuid = getOrderUuid();
        const rows = document.querySelectorAll('#local_data table tbody tr.normal');
        const lines = [];

        rows.forEach(row => {
            const titleLink = row.querySelector('.productDataTd a[data-product-uuid]');
            const rawTitle = titleLink ? titleLink.textContent.trim() : '';
            if (!rawTitle.includes('[ext]')) return;

            const locationSpan = row.querySelector('td.productPicklocation .stockLocationName');
            if (!locationSpan || !locationSpan.textContent.includes('00. Extern')) return;

            const productId = (row.querySelector('.productSku')?.textContent || '').trim();
            const details = row.querySelector('.productDataTd .align-middle')?.textContent || '';

            const ean = (details.match(/EAN:\s*([0-9A-Za-z]+)/) || [,''])[1];

            let size = (details.match(/Size:\s*([^|]+)/i) || [,''])[1].trim();
            if (!size) {
                size = (details.match(/Maat:\s*([^|]+)/i) || [,''])[1].trim();
            }

            const qty = row.querySelector('.count-row input.pickNumber')?.value || '';
            const amount = qty.includes('/') ? qty.split('/')[1].trim() : qty.trim();

            const cols = [
                orderId,
                rawTitle,
                productId,
                ean,
                size,
                amount,
                orderUuid   // ← nu als laatste
            ].map(s => (s || '').replace(/\t/g, ' ').replace(/\n/g, ' '));

            lines.push(cols.join('\t'));
        });

        return lines;
    }

    function createButton() {
        const headerEl = findPickingHeader();
        if (!headerEl) return;

        const btn = document.createElement('button');
        btn.textContent = 'Copy2Order';
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-secondary';
        btn.style.marginLeft = '0.75rem';
        btn.disabled = true;
        btn.title = 'Zoeken naar externe producten…';

        headerEl.appendChild(btn);

        const matches = collectMatches();

        if (matches.length === 0) {
            btn.disabled = true;
            btn.classList.remove('btn-primary');
            btn.classList.remove('btn-secondary');
            btn.title = 'Geen [ext] met 00. Extern in deze order';
        } else {
            btn.disabled = false;
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
            btn.title = 'Kopieer externe regels naar klembord';

            btn.addEventListener('click', () => {
                const text = matches.join('\n');
                copy(text);
            });
        }
    }

    function copy(text) {
        if (!text) return;

        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, { type:'text/plain' });
            return;
        }

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(()=>fallback(text));
            return;
        }

        fallback(text);
    }

    function fallback(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }

    function init() {
        let tries = 0;
        const interval = setInterval(() => {
            if (findPickingHeader() && document.querySelector('#local_data table')) {
                clearInterval(interval);
                createButton();
            } else if (++tries > 20) clearInterval(interval);
        }, 500);
    }

    init();
})();
