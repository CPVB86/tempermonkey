// ==UserScript==
// @name         GG | Copy2Order Bulk
// @namespace    https://dutchdesignersoutlet.com/
// @version      1.5
// @description  Verwerkt orders met tag extern, kopieert geldige externe productregels en verwijdert een onterechte tag extern.
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

    function addButton() {
        const header = document.querySelector('.orders-index-table-header');

        if (!header) {
            log('Geen .orders-index-table-header gevonden.');
            return;
        }

        const container =
            header.querySelector('.orders-index-search-container') ||
            header;

        if (document.getElementById(BUTTON_ID)) {
            return;
        }

        const button = document.createElement('button');

        button.id = BUTTON_ID;
        button.type = 'button';
        button.className = 'btn btn-primary ml-2';
        button.textContent = '🚀 Copy2Order Bulk';
        button.style.whiteSpace = 'nowrap';
        button.style.padding = '2px 6px';
        button.style.fontSize = '13px';

        button.addEventListener('click', () => {
            startCrawl().catch(error => {
                console.error('[Copy2Order Crawler]', error);

                setButtonDisabled(false);

                alert(
                    'Er ging iets mis tijdens het crawlen. ' +
                    'Zie de console voor details.'
                );
            });
        });

        container.appendChild(button);

        log('Knop toegevoegd.');
    }

    function setButtonDisabled(disabled, labelExtra = '') {
        const button = document.getElementById(BUTTON_ID);

        if (!button) {
            return;
        }

        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }

        button.disabled = disabled;

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

        button.disabled = false;
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
            hasTag(order, TAG_EXTERN) &&
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
                'input[type="checkbox"]'
            );

            if (!checkbox) {
                return;
            }

            if (isQualifyingOrder(order)) {
                checkbox.checked = true;
                selectedCount += 1;
            } else {
                checkbox.checked = false;
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

        if (!response.ok || payload?.success === false) {
            throw new Error(
                `Tag "${slug}" wijzigen mislukt ` +
                `(HTTP ${response.status})`
            );
        }

        return payload;
    }

    async function removeExternTag(uuid, csrfToken) {
        await toggleTag(uuid, TAG_EXTERN, csrfToken);

        log(
            `Tag "${TAG_EXTERN}" verwijderd van order`,
            uuid
        );
    }

    // ---------------------------------------------------------
    // 4. Orderdetails ophalen
    // ---------------------------------------------------------

    async function fetchOrderHtml(uuid) {
        const response = await fetch(
            `/orders/view/${encodeURIComponent(uuid)}`,
            {
                credentials: 'include',
                cache: 'no-store'
            }
        );

        if (!response.ok) {
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

        const headerSpan = doc.querySelector(
            '.page_title span'
        );

        if (headerSpan) {
            const headerText =
                headerSpan.textContent || '';

            const match = headerText.match(
                /Bestelling\s+(\d+)/
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

        const tableWrapper = portlet.querySelector(
            '.order_items_table'
        );

        if (!tableWrapper) {
            throw new Error(
                `Producttabel niet gevonden voor order ` +
                `${finalOrderId || uuid}`
            );
        }

        const rows = tableWrapper.querySelectorAll(
            'tbody tr.normal'
        );

        rows.forEach(row => {
            try {
                const titleLink = row.querySelector(
                    'td.productDataTd a[data-product-uuid]'
                );

                if (!titleLink) {
                    return;
                }

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

                if (!locationSpan) {
                    return;
                }

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
                    : '';

                const infoCell = row.querySelector(
                    'td.productDataTd ' +
                    '.d-table-cell.align-middle'
                );

                let ean = '';
                let size = '';

                if (infoCell) {
                    const infoText = infoCell.textContent
                        .replace(/\s+/g, ' ')
                        .trim();

                    const eanMatch = infoText.match(
                        /EAN:\s*([0-9]+)/i
                    );

                    if (eanMatch) {
                        ean = eanMatch[1];
                    }

                    const sizeMatch = infoText.match(
                        /Size:\s*([^|]+)/i
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

        try {
            await navigator.clipboard.writeText(tsv);

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
                'schrijven mislukte. De TSV staat in de console.'
            );

            console.log(
                '---- BEGIN TSV ----\n' +
                tsv +
                '\n---- END TSV ----'
            );
        }
    }

    // ---------------------------------------------------------
    // 8. Init
    // ---------------------------------------------------------

    function init() {
        log(
            'Userscript geladen, probeer knop toe te voegen…'
        );

        addButton();
    }

    init();
})();
