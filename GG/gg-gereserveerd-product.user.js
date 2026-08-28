// ==UserScript==
// @name         GG | Inkomend product gereserveerde bestellingen
// @namespace    gg-incoming-reserved-orders
// @version      1.1.0
// @description  Toont bij gescande inkomende producten voor welke bestellingen de voorraad is gereserveerd.
// @match        https://fm-e-warehousing.goedgepickt.nl/products/incoming*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/gg-gereserveerd-product.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/gg-gereserveerd-product.user.js
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const SCRIPT_NAME = "[GG Incoming Reserved Orders]";
    const TABLE_SELECTOR = "#scannedIncomingProductsTable";
    const ROW_SELECTOR = `${TABLE_SELECTOR} tbody.scanned_products_body > tr[data-product-uuid]`;
    const RESULT_CLASS = "gg-reserved-orders-result";
    const cache = new Map();
    const inFlight = new Map();

    function injectCss() {
        if (document.getElementById("gg-reserved-orders-css")) return;

        const style = document.createElement("style");
        style.id = "gg-reserved-orders-css";
        style.textContent = `
            .${RESULT_CLASS} {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: .35rem;
                margin-top: .4rem;
            }
            .gg-reserved-orders-label {
                color: #6c757d;
                font-size: 12px;
            }
            .gg-reserved-order-pill {
                display: inline-flex;
                align-items: center;
                padding: .2rem .55rem;
                border: 1px solid #d39e00;
                border-radius: 999px;
                background: #ffe8a1;
                color: #533f03 !important;
                font-size: 12px;
                font-weight: 600;
                line-height: 1.2;
                white-space: nowrap;
                text-decoration: none !important;
            }
            .gg-reserved-order-pill:hover {
                background: #ffda6a;
                color: #332701 !important;
            }
            .gg-reserved-orders-loading,
            .gg-reserved-orders-error {
                color: #6c757d;
                font-size: 12px;
            }
            .gg-reserved-orders-error {
                color: #b21f2d;
            }
        `;
        document.head.appendChild(style);
    }

    function getProductCell(row) {
        // De tweede kolom bevat productnaam, productcode, opties en EAN.
        return row.cells[1] || null;
    }

    function getResultContainer(row) {
        const cell = getProductCell(row);
        if (!cell) return null;

        let result = cell.querySelector(`:scope > .${RESULT_CLASS}`);
        if (!result) {
            result = document.createElement("div");
            result.className = RESULT_CLASS;
            cell.appendChild(result);
        }
        return result;
    }

    function showLoading(row) {
        const result = getResultContainer(row);
        if (!result) return;
        result.replaceChildren();

        const loading = document.createElement("span");
        loading.className = "gg-reserved-orders-loading";
        loading.textContent = "Bestellingen controleren…";
        result.appendChild(loading);
    }

    function showError(row) {
        const result = getResultContainer(row);
        if (!result) return;
        result.replaceChildren();

        const error = document.createElement("span");
        error.className = "gg-reserved-orders-error";
        error.textContent = "Controle bestellingen mislukt";
        error.title = "Open de browserconsole voor meer informatie.";
        result.appendChild(error);
    }

    function showOrders(row, orders) {
        const result = getResultContainer(row);
        if (!result) return;
        result.replaceChildren();

        // Volgens de wens tonen we alleen iets wanneer het product in een bestelling staat.
        if (orders.length === 0) {
            result.remove();
            return;
        }

        const label = document.createElement("span");
        label.className = "gg-reserved-orders-label";
        label.textContent = orders.length === 1
            ? "In bestelling:"
            : "In bestellingen:";
        result.appendChild(label);

        for (const order of orders) {
            const pill = document.createElement("a");
            pill.className = "gg-reserved-order-pill";
            pill.textContent = order.number;
            pill.href = order.href;
            pill.target = "_blank";
            pill.rel = "noopener noreferrer";
            pill.title = `Open bestelling ${order.number}`;
            result.appendChild(pill);
        }
    }

    function parseReservedOrders(doc) {
        const orders = new Map();

        for (const row of doc.querySelectorAll("#reservedForTable tbody tr")) {
            // De orderkolom is de derde kolom. De href is betrouwbaarder dan
            // DataTables-klassen, die op de <th> staan maar niet op de <td>.
            const link = row.querySelector('td:nth-child(3) a[href*="/orders/view/"]');
            if (!link) continue;

            const number = link.textContent.trim();
            const href = link.getAttribute("href");
            if (!number || !href) continue;

            const absoluteHref = new URL(href, location.origin).href;
            orders.set(`${number}|${absoluteHref}`, { number, href: absoluteHref });
        }

        return [...orders.values()];
    }

    function loadRenderedProductPage(productUuid) {
        return new Promise((resolve, reject) => {
            const iframe = document.createElement("iframe");
            let pollTimer = null;
            let timeoutTimer = null;
            let settled = false;
            let loadedAt = 0;
            let requestedLargestPage = false;
            let lastSignature = "";
            let stablePolls = 0;

            iframe.hidden = true;
            iframe.setAttribute("aria-hidden", "true");
            iframe.tabIndex = -1;
            iframe.style.cssText = "display:none!important;width:0;height:0;border:0";

            const cleanup = () => {
                clearInterval(pollTimer);
                clearTimeout(timeoutTimer);
                iframe.remove();
            };

            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback(value);
            };

            iframe.addEventListener("load", () => {
                loadedAt = Date.now();
                // De productpagina initialiseert reservedForTable via JavaScript/DataTables.
                // Wacht daarom op de DataTables-wrapper én tot de laadindicator klaar is.
                pollTimer = setInterval(() => {
                    try {
                        const doc = iframe.contentDocument;
                        const table = doc?.querySelector("#reservedForTable");
                        const wrapper = doc?.querySelector("#reservedForTable_wrapper");
                        const info = doc?.querySelector("#reservedForTable_info");
                        const processing = doc?.querySelector("#reservedForTable_processing");
                        const isProcessing = processing &&
                            iframe.contentWindow.getComputedStyle(processing).display !== "none";

                        // Vraag de grootste beschikbare pagina op, zodat niet alleen de
                        // eerste tien reserveringen worden teruggegeven.
                        const lengthSelect = doc?.querySelector("#reservedForTable_length select");
                        if (table && lengthSelect && !requestedLargestPage) {
                            const largestValue = [...lengthSelect.options]
                                .map((option) => Number(option.value))
                                .filter(Number.isFinite)
                                .sort((a, b) => b - a)[0];

                            requestedLargestPage = true;
                            if (largestValue && Number(lengthSelect.value) !== largestValue) {
                                lengthSelect.value = String(largestValue);
                                lengthSelect.dispatchEvent(new Event("change", { bubbles: true }));
                                stablePolls = 0;
                                return;
                            }
                        }

                        const signature = table && info
                            ? `${info.textContent}|${table.tBodies[0]?.rows.length || 0}`
                            : "";
                        stablePolls = signature && signature === lastSignature
                            ? stablePolls + 1
                            : 0;
                        lastSignature = signature;

                        if (table && wrapper && info && !isProcessing &&
                            Date.now() - loadedAt >= 750 && stablePolls >= 2) {
                            finish(resolve, doc);
                        }
                    } catch (error) {
                        finish(reject, error);
                    }
                }, 150);
            }, { once: true });

            iframe.addEventListener("error", () => {
                finish(reject, new Error("Productpagina kon niet worden geladen"));
            }, { once: true });

            timeoutTimer = setTimeout(() => {
                finish(reject, new Error("Timeout bij laden van reserveringen"));
            }, 20000);

            iframe.src = `/products/view/${encodeURIComponent(productUuid)}`;
            document.body.appendChild(iframe);
        });
    }

    async function fetchReservedOrders(productUuid) {
        if (cache.has(productUuid)) return cache.get(productUuid);
        if (inFlight.has(productUuid)) return inFlight.get(productUuid);

        const request = (async () => {
            const productDocument = await loadRenderedProductPage(productUuid);
            const orders = parseReservedOrders(productDocument);
            cache.set(productUuid, orders);
            return orders;
        })();

        inFlight.set(productUuid, request);
        try {
            return await request;
        } finally {
            inFlight.delete(productUuid);
        }
    }

    async function processRow(row) {
        const productUuid = row.dataset.productUuid;
        if (!productUuid) return;

        // Een unieke scanregel hoeft maar eenmaal verwerkt te worden. Wanneer de
        // site de regel vervangt, is het een nieuw DOM-element en wordt hij opnieuw gezien.
        if (row.dataset.ggReservedOrdersUuid === productUuid) return;
        row.dataset.ggReservedOrdersUuid = productUuid;
        showLoading(row);

        try {
            showOrders(row, await fetchReservedOrders(productUuid));
        } catch (error) {
            console.warn(SCRIPT_NAME, `Controle mislukt voor ${productUuid}`, error);
            showError(row);
        }
    }

    function processRows(root = document) {
        if (root instanceof Element && root.matches(ROW_SELECTOR)) {
            void processRow(root);
        }

        for (const row of root.querySelectorAll?.(ROW_SELECTOR) || []) {
            void processRow(row);
        }
    }

    let scanTimer = null;
    function scheduleScan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => processRows(), 75);
    }

    injectCss();
    processRows();

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
})();
