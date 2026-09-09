// ==UserScript==
// @name         GG Toolbox | Adapter | 2Order
// @namespace    https://dutchdesignersoutlet.com/
// @version      1.1.0
// @description  Verwerkt orders met tag extern, kopieert geldige externe productregels en verwijdert een onterechte tag extern.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @run-at       document-end
// @grant        none
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-2order.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-2order.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.__gg2Order) return;
    const allowed = () => window.__ggToolbox?.isEnabled('twoOrder') === true;
    const requireAccess = () => { if (!allowed()) throw new Error('Geen toegang via de core'); };
    let operating = false;
    const cleaned = new Set();
    let pendingTsv = '';
    const ORDER_TABLE_SELECTOR = '#order_index_datatable';
    const BUTTON_ID = 'gg-copy2order-crawl-btn';

    const TAG_EXTERN = 'extern';
    const TAG_GEPRINT = 'geprint_extern';

    function log(...args) {
        console.log('[Copy2Order Crawler]', ...args);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ---------------------------------------------------------
    // 1. Knop
    // ---------------------------------------------------------

    function setButtonDisabled(disabled, labelExtra = '') {
        const button = document.getElementById(BUTTON_ID);

        if (!button) {
            return;
        }

        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }

        button.disabled = disabled || operating;

        if (disabled) {
            button.textContent =
                button.dataset.originalText +
                (labelExtra ? ` – ${labelExtra}` : '…');
        } else {
            button.textContent = button.dataset.originalText;
        }
    }

    function showButtonMessage(message, timeoutMs = 5000) {
        const button = document.getElementById(BUTTON_ID);

        if (!button) {
            return;
        }

        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }

        button.disabled = operating;
        button.textContent = message;

        setTimeout(() => {
            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
            }
        }, timeoutMs);
    }

    // ---------------------------------------------------------
    // 2. DataTable en tags
    // ---------------------------------------------------------

    function getDatatable() {
        if (
            !window.jQuery ||
            !window.jQuery.fn ||
            !window.jQuery.fn.dataTable
        ) {
            return null;
        }

        try {
            if (!window.jQuery.fn.dataTable.isDataTable(ORDER_TABLE_SELECTOR)) return null;
            return window.jQuery(ORDER_TABLE_SELECTOR).DataTable();
        } catch {
            return null;
        }
    }

    function hasTag(order, slug) {
        if (!order || !Array.isArray(order.tags)) {
            return false;
        }

        return order.tags.some(tag => tag.slug === slug);
    }

    function isQualifyingOrder(order) {
        return (
            !cleaned.has(order?.uuid) && hasTag(order, TAG_EXTERN) &&
            !hasTag(order, TAG_GEPRINT)
        );
    }

    function selectMatchingOrders(datatable) {
        const rows = datatable.rows({ filter: 'applied' });
        let selectedCount = 0;

        rows.every(function () {
            const order = this.data();
            const node = this.node();

            if (!node) {
                return;
            }

            const checkbox = node.querySelector(
                'input.orders[name="orders[]"]'
            );

            if (!checkbox) {
                return;
            }

            if (isQualifyingOrder(order)) {
                setCheckbox(checkbox, true);
                selectedCount += 1;
            } else {
                setCheckbox(checkbox, false);
            }
        });

        log(
            'Aantal automatisch geselecteerde orders:',
            selectedCount
        );

        return selectedCount;
    }

    // ---------------------------------------------------------
    // 3. CSRF en tag wijzigen
    // ---------------------------------------------------------

    function getCsrfToken(doc = document) {
        const meta = doc.querySelector('meta[name="csrf-token"]');

        if (meta?.content) {
            return meta.content;
        }

        const input = doc.querySelector('input[name="_token"]');

        if (input?.value) {
            return input.value;
        }

        const html = doc.documentElement?.innerHTML || '';

        const match =
            html.match(
                /csrf-token["'][^>]+content=["']([^"']+)/i
            ) ||
            html.match(
                /name=["']_token["'][^>]+value=["']([^"']+)/i
            );

        return match ? match[1] : '';
    }

    async function toggleTag(uuid, slug, csrfToken) {
        requireAccess();
        const body = new URLSearchParams();

        body.set('_token', csrfToken);
        body.append('tags[]', slug);

        const response = await fetch(
            `/settings/tags/0/${encodeURIComponent(uuid)}/toggle`,
            {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: '*/*',
                    'Content-Type':
                        'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-CSRF-TOKEN': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: body.toString()
            }
        );

        let payload = null;

        try {
            payload = await response.clone().json();
        } catch {
            payload = await response.text();
        }

        if (!response.ok || response.redirected || payload?.success === false || payload?.error || (typeof payload === "string" && /^\s*</.test(payload))) {
            throw new Error(
                `Tag "${slug}" wijzigen mislukt ` +
                `(HTTP ${response.status})`
            );
        }

        return payload;
    }

    async function removeExternTag(uuid, csrfToken) {
        if (cleaned.has(uuid)) return;
        await toggleTag(uuid, TAG_EXTERN, csrfToken);
        cleaned.add(uuid);

        log(
            `Tag "${TAG_EXTERN}" verwijderd van order`,
            uuid
        );
    }

    // ---------------------------------------------------------
    // 4. Orderdetails ophalen
    // ---------------------------------------------------------

    async function fetchOrderHtml(uuid) {
        requireAccess();
        const response = await fetch(
            `/orders/view/${encodeURIComponent(uuid)}`,
            {
                credentials: 'include',
                cache: 'no-store'
            }
        );

        if (!response.ok || response.redirected) {
            throw new Error(
                `HTTP ${response.status} bij ophalen order ${uuid}`
            );
        }

        return response.text();
    }

    function parseOrderHtml(html) {
        return new DOMParser().parseFromString(
            html,
            'text/html'
        );
    }

    function todayNlDate() {
        const date = new Date();
        const pad = value =>
            String(value).padStart(2, '0');

        return (
            `${pad(date.getDate())}-` +
            `${pad(date.getMonth() + 1)}-` +
            `${date.getFullYear()}`
        );
    }

    function extractOrderDateFromRowNode(node) {
        if (!node) {
            return todayNlDate();
        }

        const lastCell = node.querySelector('td:last-child');

        const raw = lastCell
            ? lastCell.textContent.replace(/\s+/g, ' ').trim()
            : '';

        const dateMatch = raw.match(
            /\b\d{2}-\d{2}-\d{4}\b/
        );

        return dateMatch
            ? dateMatch[0]
            : todayNlDate();
    }

    function findRowNodeByUuid(datatable, uuid) {
        let foundNode = null;

        datatable.rows({ filter: 'applied' }).every(function () {
            const order = this.data();

            if (order?.uuid === uuid) {
                foundNode = this.node();
            }
        });

        return foundNode;
    }

    // ---------------------------------------------------------
    // 5. Productregels uitlezen
    // ---------------------------------------------------------

    function extractProductsFromDoc(
        doc,
        uuid,
        orderId,
        orderDate
    ) {
        const results = [];

        let finalOrderId = orderId || '';

        const headerSpan = [...doc.querySelectorAll('.page_title span')].find(span => /Bestelling\s+\d+/i.test(span.textContent));

        if (headerSpan) {
            const headerText =
                headerSpan.textContent || '';

            const match = headerText.match(
                /Bestelling\s+(\d+)/i
            );

            if (match) {
                finalOrderId = match[1];
            }
        }

        const portletHeads = Array.from(
            doc.querySelectorAll('.m-portlet__head-text')
        );

        const pickHeader = portletHeads.find(header =>
            header.textContent
                .trim()
                .toLowerCase()
                .includes('te picken producten')
        );

        if (!pickHeader) {
            throw new Error(
                `Sectie "Te picken producten" niet gevonden ` +
                `voor order ${finalOrderId || uuid}`
            );
        }

        const portlet = pickHeader.closest('.m-portlet');

        if (!portlet) {
            throw new Error(
                `Productportlet niet gevonden voor order ` +
                `${finalOrderId || uuid}`
            );
        }

        const tableWrapper = portlet.querySelector('.order_items_table') || portlet.querySelector('#local_data table') || portlet.querySelector('table');

        if (!tableWrapper) {
            throw new Error(
                `Producttabel niet gevonden voor order ` +
                `${finalOrderId || uuid}`
            );
        }

        const rows = tableWrapper.querySelectorAll(
            'tbody tr.normal'
        );

        if (!rows.length) throw new Error('Geen geladen productregels; extern-tag blijft behouden');
        rows.forEach(row => {
            try {
                const titleLink = row.querySelector(
                    'td.productDataTd a[data-product-uuid]'
                );

                if (!titleLink) throw new Error('Producttitel ontbreekt; order niet aangepast');

                const rawTitle = titleLink.textContent
                    .replace(/\s+/g, ' ')
                    .trim();

                const titleLower = rawTitle.toLowerCase();

                const isExternalProduct =
                    titleLower.includes('[ext') ||
                    titleLower.includes('[bar');

                if (!isExternalProduct) {
                    return;
                }

                const locationSpan = row.querySelector(
                    'td.productPicklocation .stockLocationName'
                );

                if (!locationSpan) throw new Error('Picklocatie ontbreekt; order niet aangepast');

                const locationText =
                    locationSpan.textContent
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

                const isAllowedLocation =
                    locationText.startsWith('00. extern') ||
                    locationText.startsWith('00. tussenstop');

                if (!isAllowedLocation) {
                    return;
                }

                const plusButton = row.querySelector(
                    'button.plus[data-product-sku]'
                );

                const productId = plusButton
                    ? (
                        plusButton.getAttribute(
                            'data-product-sku'
                        ) || ''
                    ).trim()
                    : (row.querySelector('.productSku')?.textContent || '').trim();

                const infoCell = row.querySelector(
                    'td.productDataTd ' +
                    '.align-middle'
                );

                let ean = '';
                let size = '';

                if (infoCell) {
                    const infoText = infoCell.textContent
                        .replace(/\s+/g, ' ')
                        .trim();

                    const eanMatch = infoText.match(
                        /EAN:\s*([0-9A-Za-z]+)/i
                    );

                    if (eanMatch) {
                        ean = eanMatch[1];
                    }

                    const sizeMatch = infoText.match(
                        /(?:Size|Maat):\s*([^|]+)/i
                    );

                    if (sizeMatch) {
                        size = sizeMatch[1].trim();
                    }
                }

                const quantityInput = row.querySelector(
                    'input.pickNumber'
                );

                let amount = '1';

                if (quantityInput?.value) {
                    const parts =
                        quantityInput.value.split('/');

                    amount = parts.length === 2 ? parts[1].trim() : quantityInput.value.trim();
                }

                results.push({
                    title: rawTitle,
                    productId,
                    ean,
                    size,
                    amount,
                    uuid,
                    orderId: finalOrderId,
                    orderDate:
                        orderDate || todayNlDate()
                });
            } catch (error) {
                console.error(
                    'Fout bij parsen productregel in order',
                    finalOrderId,
                    uuid,
                    error
                );
                throw error;
            }
        });

        return results;
    }

    // ---------------------------------------------------------
    // 6. TSV
    // ---------------------------------------------------------

    function buildTsv(products) {
        const escape = value =>
            (value || '')
                .toString()
                .replace(/\t/g, ' ')
                .replace(/\r?\n/g, ' ');

        return products
            .map(product => [
                escape(product.orderId),
                escape(product.title),
                escape(product.productId),
                escape(product.ean),
                escape(product.size),
                escape(product.amount),
                escape(product.uuid),
                '',
                escape(product.orderDate)
            ].join('\t'))
            .join('\n');
    }

    // ---------------------------------------------------------
    // 7. Crawl
    // ---------------------------------------------------------

    async function startCrawl() {
        requireAccess();
        const datatable = getDatatable();

        if (!datatable) {
            alert(
                'De orders-tabel lijkt nog niet klaar. ' +
                'Probeer het over een paar seconden opnieuw.'
            );

            return;
        }

        const csrfToken = getCsrfToken();

        if (!csrfToken) {
            alert(
                'CSRF-token niet gevonden. ' +
                'De tags kunnen daarom niet veilig worden aangepast.'
            );

            return;
        }

        setButtonDisabled(true, 'zoeken…');

        const data = datatable
            .rows({ filter: 'applied' })
            .data()
            .toArray();

        const targets = data.filter(order => {
            try {
                return isQualifyingOrder(order);
            } catch {
                return false;
            }
        });

        if (!targets.length) {
            setButtonDisabled(false);

            alert(
                'Geen orders gevonden met tag "extern" ' +
                'zonder "geprint_extern" in de huidige selectie.'
            );

            return;
        }

        log('Gevonden orders:', targets.length);

        selectMatchingOrders(datatable);

        const allProducts = [];

        let cleanedOrders = 0;
        let failedOrders = 0;

        for (
            let index = 0;
            index < targets.length;
            index += 1
        ) {
            requireAccess();
            const order = targets[index];
            const uuid = order.uuid;

            const orderLabel =
                order.external_display_id ||
                order.id ||
                '?';

            const rowNode = findRowNodeByUuid(
                datatable,
                uuid
            );

            const orderDate =
                extractOrderDateFromRowNode(rowNode);

            setButtonDisabled(
                true,
                `order ${index + 1}/${targets.length} ` +
                `(${orderLabel})`
            );

            try {
                const html = await fetchOrderHtml(uuid);
                const doc = parseOrderHtml(html);

                const products = extractProductsFromDoc(
                    doc,
                    uuid,
                    orderLabel,
                    orderDate
                );

                log(
                    `Order ${orderLabel}: ` +
                    `${products.length} externe regels gevonden.`
                );

                if (products.length === 0) {
                    /*
                     * De order kon correct worden opgehaald en
                     * de producttabel kon correct worden gelezen,
                     * maar bevat geen enkele geldige externe regel.
                     *
                     * Alleen dan verwijderen we de tag "extern".
                     */
                    await removeExternTag(
                        uuid,
                        csrfToken
                    );

                    order.tags = order.tags.filter(tag => tag.slug !== TAG_EXTERN);
                    cleanedOrders += 1;

                    log(
                        `Order ${orderLabel}: geen geldige externe ` +
                        `regels; tag "extern" verwijderd.`
                    );
                } else {
                    allProducts.push(...products);
                }
            } catch (error) {
                /*
                 * Belangrijk: bij iedere fout blijft "extern"
                 * gewoon staan. We weten dan immers niet zeker
                 * dat de order werkelijk intern is.
                 */
                failedOrders += 1;

                console.error(
                    `Order ${orderLabel} niet volledig verwerkt. ` +
                    `Tag "extern" blijft behouden.`,
                    uuid,
                    error
                );
            }

            await sleep(400);
        }

        setButtonDisabled(false);

        if (!allProducts.length) {
            showButtonMessage(
                `✅ Klaar: ${cleanedOrders} onterechte ` +
                `extern-tag${cleanedOrders === 1 ? '' : 's'} verwijderd.`,
                8000
            );

            if (failedOrders) {
                alert(
                    `${cleanedOrders} onterechte extern-tag(s) ` +
                    `verwijderd.\n\n` +
                    `${failedOrders} order(s) konden niet volledig ` +
                    `worden gecontroleerd. Bij die orders is de tag ` +
                    `"extern" voor de veiligheid blijven staan.`
                );
            }

            return;
        }

        const tsv = buildTsv(allProducts);
        pendingTsv = tsv;

        try {
            requireAccess();
            await navigator.clipboard.writeText(tsv);
            pendingTsv = '';

            let message =
                `✅ ${allProducts.length} regels gekopieerd`;

            if (cleanedOrders) {
                message +=
                    ` · ${cleanedOrders} extern-tag` +
                    `${cleanedOrders === 1 ? '' : 's'} verwijderd`;
            }

            if (failedOrders) {
                message +=
                    ` · ${failedOrders} fout` +
                    `${failedOrders === 1 ? '' : 'en'}`;
            }

            showButtonMessage(`${message}.`, 8000);
        } catch (error) {
            console.error(
                'Clipboard-fout:',
                error
            );

            alert(
                'Regels verzameld, maar naar het klembord ' +
                'schrijven mislukte. Klik opnieuw op Copy2Order Bulk om het kopiëren opnieuw te proberen.'
            );


        }
    }

    // ---------------------------------------------------------
    // Shared controls: three on the overview, one on the order detail.
    function setCheckbox(checkbox, checked) {
        if (!checkbox || checkbox.disabled || checkbox.checked === checked) return;
        checkbox.checked = checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function parseOrderIds(text) {
        return new Set(String(text || '').split(/\s+/).filter(value => /^\d+$/.test(value)));
    }
    function orderRows() {
        const dt = getDatatable(), nodes = [];
        if (dt) dt.rows({ filter:'applied' }).every(function () { if (this.node()) nodes.push(this.node()); });
        else nodes.push(...document.querySelectorAll(ORDER_TABLE_SELECTOR + ' tbody tr'));
        return nodes;
    }
    const rowOrderId = row => row.querySelector('td.external_id a, td:nth-child(3) a')?.textContent.trim() || '';
    async function pasteSelect(button) {
        const wanted = parseOrderIds(await navigator.clipboard.readText());
        requireAccess();
        if (!wanted.size) { button.textContent = 'Geen ordernummers op klembord'; return; }
        let count = 0;
        for (const row of orderRows()) {
            const checkbox = row.querySelector('input.orders[name="orders[]"]');
            if (wanted.has(rowOrderId(row)) && checkbox && !checkbox.disabled && !checkbox.checked) { setCheckbox(checkbox, true); count++; }
        }
        button.textContent = count + ' orders geselecteerd';
    }
    async function copySelect(button) {
        const ids = [...new Set(orderRows().filter(row => row.querySelector('input.orders[name="orders[]"]')?.checked).map(rowOrderId).filter(Boolean))];
        if (!ids.length) { button.textContent = 'Geen orders geselecteerd'; return; }
        requireAccess();
        await navigator.clipboard.writeText(ids.join('\n'));
        button.textContent = ids.length + ' orders gekopieerd';
    }
    function currentProducts() {
        const uuid = location.pathname.match(/^\/orders\/view\/([^/]+)/)?.[1];
        if (!uuid) return [];
        const date = document.body.textContent.match(/\b\d{2}-\d{2}-\d{4}\b/)?.[0] || todayNlDate();
        return extractProductsFromDoc(document, uuid, '', date);
    }
    function pickingHeader() {
        return [...document.querySelectorAll('.m-portlet__head-text')].find(el => el.textContent.includes('Te picken producten'));
    }
    async function copyCurrent(button) {
        const uuid = location.pathname.match(/^\/orders\/view\/([^/]+)/)?.[1];
        if (!uuid) throw new Error('Orderreferentie ontbreekt');
        // Uses the exact same product selection and TSV columns as the bulk export.
        const products = currentProducts();
        if (!products.length) { button.textContent = 'Geen externe productregels'; return; }
        requireAccess();
        await navigator.clipboard.writeText(buildTsv(products));
        button.textContent = products.length + ' regels gekopieerd';
    }
    async function operate(button, action) {
        if (!allowed() || operating) return;
        operating = true;
        syncButtons();
        try {
            if (action === startCrawl && pendingTsv) {
                requireAccess();
                await navigator.clipboard.writeText(pendingTsv);
                pendingTsv = '';
                button.textContent = 'Verzamelde regels gekopieerd';
            } else await action(button);
        } catch (error) { button.textContent = 'Mislukt: ' + error.message; }
        finally { operating = false; syncButtons(); }
    }
    function makeButton(label, action, id) {
        const button = document.createElement('button');
        button.type = 'button'; button.id = id; button.textContent = label;
        button.dataset.originalText = label;
        button.className = 'btn btn-primary ml-2';
        Object.assign(button.style, { whiteSpace:'nowrap', height:'40px', padding:'0 10px', fontSize:'13px', fontWeight:'400' });
        button.onclick = () => operate(button, action);
        return button;
    }
    function syncButtons() {
        const wrapper = document.getElementById('gg-2order-controls');
        if (wrapper) wrapper.querySelectorAll('button').forEach(button => { let noMatches = false;
            if (button.id === 'gg-2order-copy-current') {
                try { noMatches = !currentProducts().length; } catch { noMatches = true; }
                button.title = noMatches ? 'Geen passende externe productregels of tabel nog niet geladen' : 'Kopieer externe regels naar klembord';
            }
            button.disabled = operating || !allowed() || noMatches; });
    }
    function install() {
        const detail = /^\/orders\/view\//.test(location.pathname);
        const overview = /^\/orders(?:\/|$)/.test(location.pathname) && !detail && document.querySelector(ORDER_TABLE_SELECTOR);
        const existing = document.getElementById('gg-2order-controls');
        const mode = detail ? 'detail' : 'overview';
        if (detail) void startTagWorker();
        if (!allowed() || (!detail && !overview)) { existing?.remove(); return; }
        if (existing?.dataset.mode === mode) { syncButtons(); return; }
        existing?.remove();
        const header = document.querySelector('.orders-index-table-header');
        const target = detail ? pickingHeader() : header?.querySelector('.orders-index-search-container') || header || overview?.parentNode;
        if (!target) return;
        const wrap = document.createElement('div'); wrap.id = 'gg-2order-controls'; wrap.dataset.mode = mode;
        Object.assign(wrap.style, { display:'inline-flex', flexWrap:'wrap', alignItems:'center', gap:'4px', marginLeft:'4px' });
        if (detail) wrap.append(makeButton('Copy2Order', copyCurrent, 'gg-2order-copy-current'));
        else wrap.append(makeButton('Copy2Order Bulk', startCrawl, BUTTON_ID), makeButton('Paste2Select', pasteSelect, 'gg-2order-paste-select'), makeButton('Copy2Select', copySelect, 'gg-2order-copy-select'));
        target.append(wrap); syncButtons();
    }

    // Paste2Order worker: reuses the same order fetch, CSRF and toggle functions.
    let handledHash = '';
    function tagRequest(hash = location.hash) {
        const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
        if (!params.has('paste2order-add-tag')) return null;
        const slug = (params.get('paste2order-add-tag') || TAG_GEPRINT).trim();
        if (!/^[a-z0-9_-]+$/i.test(slug)) throw new Error('Ongeldige tag');
        const current = location.pathname.match(/^\/orders\/view\/([^/]+)/)?.[1];
        const uuids = [...new Set([current, ...(params.get('queue') || '').split(',')].map(value => (value || '').trim()).filter(Boolean))];
        if (!uuids.length || uuids.some(uuid => !/^[a-f0-9-]+$/i.test(uuid))) throw new Error('Ongeldige orderreferentie');
        return { slug, uuids, label:(params.get('label') || slug).trim() };
    }
    function tagSelected(doc, slug, optional = false) {
        const element = [...doc.querySelectorAll('.tag-toggler[data-slug]')].find(el => el.getAttribute('data-slug') === slug);
        if (!element) {
            if (optional) return false;
            throw new Error('Tag niet gevonden: ' + slug);
        }
        const check = element.querySelector('.check');
        if (!check || check.hidden) return false;
        const style = check.getAttribute('style') || '';
        return !/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*(?:;|$))/i.test(style);
    }
    function workerStatus(text, retry = false) {
        let box = document.getElementById('gg-2order-worker-status');
        if (!box) {
            box = document.createElement('div'); box.id = 'gg-2order-worker-status';
            box.setAttribute('role', 'status');
            box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:999999;padding:8px 10px;max-width:450px;border:1px solid #cbd5df;border-radius:6px;background:white;color:#25313b;font:12px/1.4 system-ui;white-space:pre-wrap';
            document.body.append(box);
        }
        box.textContent = text;
        if (retry) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Opnieuw controleren';
            button.onclick = () => { if (!operating && allowed()) { handledHash = ''; void startTagWorker(); } };
            box.append(document.createElement('br'), button);
        }
    }
    async function processTagRequest(request, report = workerStatus) {
        const csrf = getCsrfToken();
        if (!csrf) throw new Error('CSRF-token ontbreekt');
        const conflict = request.slug === TAG_GEPRINT ? TAG_EXTERN : request.slug === 'besteld' ? TAG_GEPRINT : '';
        const failed = []; let completed = 0;
        for (const [index, uuid] of request.uuids.entries()) {
            try {
                requireAccess();
                report('Paste2Order: ' + request.label + ' controleren ' + (index+1) + '/' + request.uuids.length);
                let doc = parseOrderHtml(await fetchOrderHtml(uuid));
                if (!tagSelected(doc, request.slug)) {
                    await toggleTag(uuid, request.slug, csrf);
                    doc = parseOrderHtml(await fetchOrderHtml(uuid));
                    if (!tagSelected(doc, request.slug)) throw new Error('Toegevoegde tag niet bevestigd');
                }
                if (conflict && tagSelected(doc, conflict, true)) {
                    await toggleTag(uuid, conflict, csrf);
                    if (conflict === TAG_EXTERN) cleaned.add(uuid);
                    doc = parseOrderHtml(await fetchOrderHtml(uuid));
                    if (tagSelected(doc, conflict, true)) throw new Error('Verwijderde tag niet bevestigd');
                }
                if (!tagSelected(doc, request.slug)) throw new Error('Doeltag niet bevestigd');
                completed++;
            } catch (error) { failed.push(uuid + ': ' + error.message); }
        }
        return { completed, failed };
    }
    async function startTagWorker() {
        const hash = location.hash;
        if (!hash) { handledHash = ''; return; }
        if (!allowed() || operating || hash === handledHash) return;
        let request;
        try { request = tagRequest(hash); }
        catch (error) { handledHash = hash; workerStatus(error.message); return; }
        if (!request) return;
        handledHash = hash; operating = true; syncButtons();
        try {
            const result = await processTagRequest(request);
            if (result.failed.length) {
                workerStatus('Paste2Order: ' + result.completed + ' gereed.\n' + result.failed.join('\n'), true);
                return;
            }
            if (location.hash === hash) {
                history.replaceState(history.state, document.title, location.pathname + location.search);
                workerStatus('Paste2Order: ' + result.completed + ' orders verwerkt. Dit tabblad mag dicht.');
                await sleep(600);
                if (!location.hash && allowed()) window.close();
            }
        } catch (error) { workerStatus('Paste2Order: ' + error.message, true); }
        finally { operating = false; syncButtons(); }
    }

    function boot() {
        install();
        let scheduled = false;
        new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true; queueMicrotask(() => { scheduled = false; install(); });
        }).observe(document.body, { childList:true, subtree:true });
        setInterval(install, 1000);
    }
    window.__gg2Order = { version:'1.1.0' };
    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot, { once:true });
})();
