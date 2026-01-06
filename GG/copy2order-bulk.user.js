// ==UserScript==
// @name         GG | Copy2Order Bulk
// @namespace    https://dutchdesignersoutlet.com/
// @version      1.3
// @description  Zoek alle orders met tag 'extern' maar niet 'geprint_extern', haal [ext] + 00. Extern regels op en zet TSV in het klembord.
// @match        https://fm-e-warehousing.goedgepickt.nl/orders*
// @run-at       document-end
// @grant        none
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/copy2order-bulk.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/copy2order-bulk.user.js
// ==/UserScript==

(function () {
    'use strict';

    const ORDER_TABLE_SELECTOR = '#order_index_datatable';
    const BUTTON_ID = 'gg-copy2order-crawl-btn';

    function log(...args) {
        console.log('[Copy2Order Crawler]', ...args);
    }

    function sleep(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    // --- 1. Knop direct plaatsen in de zoekbalk-header ---

    function addButton() {
        const header = document.querySelector('.orders-index-table-header');
        if (!header) {
            log('Geen .orders-index-table-header gevonden.');
            return;
        }

        const container = header.querySelector('.orders-index-search-container') || header;

        // voorkom dubbele knop
        if (document.getElementById(BUTTON_ID)) return;

        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.className = 'btn btn-primary ml-2';
        btn.textContent = '🚀 Copy2Order Bulk';
        btn.style.whiteSpace = 'nowrap';
        // iets smaller maken
        btn.style.padding = '2px 6px';
        btn.style.fontSize = '13px';

        btn.addEventListener('click', () => {
            startCrawl().catch(err => {
                console.error(err);
                alert('Er ging iets mis tijdens het crawlen. Zie console voor details.');
            });
        });

        container.appendChild(btn);
        log('Knop toegevoegd in orders-index-search-container.');
    }

    function setButtonDisabled(disabled, labelExtra) {
        const btn = document.getElementById(BUTTON_ID);
        if (!btn) return;
        if (!btn.dataset._origText) {
            btn.dataset._origText = btn.textContent;
        }

        btn.disabled = disabled;
        if (disabled) {
            btn.textContent = btn.dataset._origText + (labelExtra ? ' – ' + labelExtra : '…');
        } else {
            btn.textContent = btn.dataset._origText;
        }
    }

    function showButtonMessage(msg, timeoutMs = 5000) {
        const btn = document.getElementById(BUTTON_ID);
        if (!btn) return;
        if (!btn.dataset._origText) {
            btn.dataset._origText = btn.textContent;
        }
        btn.disabled = false;
        btn.textContent = msg;
        setTimeout(() => {
            if (btn.dataset._origText) {
                btn.textContent = btn.dataset._origText;
            }
        }, timeoutMs);
    }

    // --- 2. Helpers voor DataTable en tags ---

    function getDatatable() {
        if (!window.jQuery || !window.jQuery.fn || !window.jQuery.fn.dataTable) {
            return null;
        }
        try {
            return window.jQuery(ORDER_TABLE_SELECTOR).DataTable();
        } catch (e) {
            return null;
        }
    }

    function hasTag(full, slug) {
        if (!full || !Array.isArray(full.tags)) return false;
        return full.tags.some(t => t.slug === slug);
    }

    // Tag 'extern' MOET aanwezig zijn
    // Tag 'geprint_extern' MAG NIET aanwezig zijn
    function isQualifyingOrder(full) {
        return hasTag(full, 'extern') && !hasTag(full, 'geprint_extern');
    }

    /**
     * Selecteer (checkbox) alle matchende orders in de huidige filter,
     * en haal selectie weg bij niet-matchende orders.
     */
    function selectMatchingOrders(dt) {
        const rowsApi = dt.rows({ filter: 'applied' });
        let selectedCount = 0;

        rowsApi.every(function () {
            const full = this.data();
            const node = this.node();
            if (!node) return;

            const checkbox = node.querySelector('input[type="checkbox"]');
            if (!checkbox) return;

            if (isQualifyingOrder(full)) {
                checkbox.checked = true;
                selectedCount++;
            } else {
                checkbox.checked = false;
            }
        });

        log('Aantal automatisch geselecteerde orders:', selectedCount);
        return selectedCount;
    }

    // --- 3. Orderdetail ophalen en producten parsen ---

    async function fetchOrderHtml(uuid) {
        const url = `/orders/view/${uuid}`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status} bij ophalen order ${uuid}`);
        return res.text();
    }

    function parseOrderHtml(html) {
        const parser = new DOMParser();
        return parser.parseFromString(html, 'text/html');
    }

    function extractProductsFromDoc(doc, uuid, orderId) {
        const results = [];

        // OrderID uit header fallback
        let finalOrderId = orderId || '';
        const headerSpan = doc.querySelector('.page_title span');
        if (headerSpan) {
            const txt = headerSpan.textContent || '';
            const m = txt.match(/Bestelling\s+(\d+)/);
            if (m) finalOrderId = m[1];
        }

        const portletHeads = Array.from(doc.querySelectorAll('.m-portlet__head-text'));
        const pickHeader = portletHeads.find(h =>
            h.textContent.trim().toLowerCase().includes('te picken producten')
        );
        if (!pickHeader) {
            log('Geen "Te picken producten" gevonden voor order', finalOrderId, uuid);
            return results;
        }

        const portlet = pickHeader.closest('.m-portlet');
        if (!portlet) return results;

        const tableWrapper = portlet.querySelector('.order_items_table');
        if (!tableWrapper) return results;

        const rows = tableWrapper.querySelectorAll('tbody tr.normal');
        rows.forEach(tr => {
            try {
                const titleLink = tr.querySelector('td.productDataTd a[data-product-uuid]');
                if (!titleLink) return;
                const rawTitle = titleLink.textContent.replace(/\s+/g, ' ').trim();

                if (!rawTitle.toLowerCase().includes('[ext')) {
                    return;
                }

                const locSpan = tr.querySelector('td.productPicklocation .stockLocationName');
                if (!locSpan) return;
                const locText = locSpan.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
                if (!locText.startsWith('00. extern')) {
                    return;
                }

                const plusBtn = tr.querySelector('button.plus[data-product-sku]');
                const productId = plusBtn ? plusBtn.getAttribute('data-product-sku').trim() : '';

                const infoCell = tr.querySelector('td.productDataTd .d-table-cell.align-middle');
                let ean = '';
                let size = '';
                if (infoCell) {
                    const infoText = infoCell.textContent.replace(/\s+/g, ' ').trim();
                    const eMatch = infoText.match(/EAN:\s*([0-9]+)/i);
                    if (eMatch) ean = eMatch[1];

                    const sMatch = infoText.match(/Size:\s*([^|]+)/i);
                    if (sMatch) size = sMatch[1].trim();
                }

                const qtyInput = tr.querySelector('input.pickNumber');
                let amount = '1';
                if (qtyInput && qtyInput.value) {
                    const parts = qtyInput.value.split('/');
                    if (parts.length === 2) {
                        amount = parts[1].trim();
                    }
                }

                results.push({
                    title: rawTitle,
                    productId,
                    ean,
                    size,
                    amount,
                    uuid,
                    orderId: finalOrderId
                });
            } catch (err) {
                console.error('Fout bij parsen productregel in order', finalOrderId, uuid, err);
            }
        });

        return results;
    }

    // → headers verwijderd in output
    function buildTsv(products) {
        const escape = v => (v || '').toString().replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
        const lines = products.map(p => [
            escape(p.orderId),
            escape(p.title),
            escape(p.productId),
            escape(p.ean),
            escape(p.size),
            escape(p.amount),
            escape(p.uuid),
            '' // Checked leeg
        ].join('\t'));
        return lines.join('\n');
    }

    // --- 4. Crawl-flow bij klik op de knop ---

    async function startCrawl() {
        const dt = getDatatable();
        if (!dt) {
            alert('De orders-tabel (DataTable) lijkt nog niet klaar. Probeer na een paar seconden opnieuw.');
            return;
        }

        setButtonDisabled(true, 'zoeken…');

        const data = dt.rows({ filter: 'applied' }).data().toArray();
        const targets = data.filter(full => {
            try {
                return isQualifyingOrder(full);
            } catch (e) {
                return false;
            }
        });

        if (!targets.length) {
            setButtonDisabled(false);
            alert('Geen orders gevonden met tag "extern" zonder "geprint_extern" in de huidige selectie.');
            return;
        }

        console.log('[Copy2Order Crawler] Gevonden orders:', targets.length);

        // 👉 Matchende orders meteen selecteren in de tabel
        selectMatchingOrders(dt);

        setButtonDisabled(true, `${targets.length} orders verwerken`);

        const allProducts = [];

        for (let i = 0; i < targets.length; i++) {
            const full = targets[i];
            const uuid = full.uuid;
            const orderLabel = full.external_display_id || full.id || '?';

            setButtonDisabled(true, `order ${i + 1}/${targets.length} (${orderLabel})`);

            try {
                const html = await fetchOrderHtml(uuid);
                const doc = parseOrderHtml(html);
                const products = extractProductsFromDoc(doc, uuid, orderLabel);
                console.log(`Order ${orderLabel}: ${products.length} externe regels gevonden.`);
                allProducts.push(...products);
            } catch (err) {
                console.error('Fout bij ophalen/parsen order', orderLabel, uuid, err);
            }

            await sleep(400);
        }

        setButtonDisabled(false);

        if (!allProducts.length) {
            alert('Geen passende productregels gevonden (met [ext] en 00. Extern) in de geselecteerde orders.');
            return;
        }

        const tsv = buildTsv(allProducts);

        try {
            await navigator.clipboard.writeText(tsv);
            // ✅ Geen alert meer, maar melding op de button
            showButtonMessage(
                `✅ ${allProducts.length} regels gekopieerd.`
            );
        } catch (err) {
            console.error('Clipboard-fout:', err);
            alert('Regels verzameld, maar naar klembord schrijven mislukte. Zie console; TSV is daar gelogd.');
            console.log('---- BEGIN TSV ----\n' + tsv + '\n---- END TSV ----');
        }
    }

    // --- Init: knop neerzetten ---

    function init() {
        log('Userscript geladen, probeer knop toe te voegen…');
        addButton();
    }

    // direct na document-end
    init();

})();
