// ==UserScript==
// @name         GG | WaGro Product Stock List
// @namespace    gg-wagro-product-stock-list
// @version      1.0.0
// @description  Check WaGro Pick Prio voor [ext] en [bar] producten in de voorraad/producttabel.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/gg-wagro-stock-list.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/gg-wagro-stock-list.user.js
// ==/UserScript==

(function () {
    "use strict";

    const wagroRe = /wagro\s*\/\s*/i;
    const targetRe = /\[(?:ext|bar)\]/i;

    const COLORS = {
        gray: "#f1f3f5",
        green: "#d4edda",
        orange: "#ffe8b3",
    };

    const BADGE_BASE =
        "display:inline-flex;align-items:center;gap:.35rem;padding:.12rem .45rem;border-radius:999px;" +
        "font-size:12px;line-height:1;border:1px solid rgba(0,0,0,.12);margin-left:.5rem;white-space:nowrap;" +
        "color:#000;";

    const cache = new Map();
    const inFlight = new Map();
    const fixing = new Set();

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function getApiToken() {
        return window?.config?.user?.api_token || null;
    }

    function getCsrfToken() {
        return document.querySelector('meta[name="csrf-token"]')?.content || null;
    }

    function injectCssOnce() {
        if (document.getElementById("gg-wagro-stock-list-css")) return;

        const style = document.createElement("style");
        style.id = "gg-wagro-stock-list-css";

        style.textContent = `
            tr.gg-wagro-gray {
                background: ${COLORS.gray} !important;
            }

            tr.gg-wagro-green {
                background: ${COLORS.green} !important;
            }

            tr.gg-wagro-orange {
                background: ${COLORS.orange} !important;
            }

            .gg-wagro-pill {
                ${BADGE_BASE}
            }

            .gg-wagro-pill--gray {
                background: ${COLORS.gray};
            }

            .gg-wagro-pill--green {
                background: ${COLORS.green};
            }

            .gg-wagro-pill--orange {
                background: ${COLORS.orange};
            }

            .gg-wagro-pill[role="button"] {
                cursor: pointer;
            }

            .gg-wagro-pill[aria-disabled="true"] {
                opacity: .65;
                cursor: default;
            }
        `;

        document.head.appendChild(style);
    }

    function clearOurDecorations(tr) {
        tr.classList.remove(
            "gg-wagro-gray",
            "gg-wagro-green",
            "gg-wagro-orange"
        );

        tr.querySelectorAll(".gg-wagro-pill").forEach((el) => el.remove());
    }

    function getProductNameCell(tr) {
        return tr.querySelector("td.productNameVal");
    }

    function rowIsTarget(tr) {
        const td = getProductNameCell(tr);
        if (!td) return false;

        return targetRe.test(td.innerText || "");
    }

    function getProductUuid(tr) {
        // 1. Voorkeur: checkbox data-uuid
        const checkbox = tr.querySelector(
            'input.products[data-uuid]'
        );

        if (checkbox?.dataset?.uuid) {
            return checkbox.dataset.uuid;
        }

        // 2. Fallback: /products/view/UUID
        const link = tr.querySelector(
            'a[href*="/products/view/"]'
        );

        if (link) {
            const match = link.getAttribute("href")
                ?.match(/\/products\/view\/([a-f0-9-]+)/i);

            if (match) return match[1];
        }

        return null;
    }

    function insertPill(td, pill) {
        const firstDiv = td.querySelector(
            ".d-inline-flex.align-items-center"
        );

        if (firstDiv) {
            firstDiv.appendChild(pill);
            return;
        }

        td.prepend(pill);
    }

    function makePill(result, tr, { loading = false } = {}) {
        const state = result?.state || "gray";

        const pill = document.createElement("span");

        pill.className =
            "gg-wagro-pill " +
            (
                state === "green"
                    ? "gg-wagro-pill--green"
                    : state === "orange"
                    ? "gg-wagro-pill--orange"
                    : "gg-wagro-pill--gray"
            );

        if (loading) {
            pill.textContent = "WaGro check ⏳";
            pill.title = "Bezig met checken…";
            pill.setAttribute("aria-disabled", "true");
            return pill;
        }

        if (state === "gray") {
            pill.textContent = "WaGro niet gevonden";
            return pill;
        }

        const prio = result.wagroPrio ?? "?";

        if (state === "green") {
            pill.textContent = `WaGro prio ${prio}`;
            return pill;
        }

        pill.textContent = `WaGro prio ${prio} 🛠️`;
        pill.setAttribute("role", "button");
        pill.tabIndex = 0;
        pill.title =
            "Klik om WaGro op prio 1 te zetten en overige locaties opnieuw te nummeren";

        const handler = async (event) => {
            event.preventDefault();
            event.stopPropagation();

            await onFixClick(
                result.productUuid,
                tr,
                pill
            );
        };

        pill.addEventListener("click", handler);

        pill.addEventListener("keydown", (event) => {
            if (
                event.key === "Enter" ||
                event.key === " "
            ) {
                handler(event);
            }
        });

        return pill;
    }

    function setRowState(
        tr,
        result,
        { loading = false } = {}
    ) {
        clearOurDecorations(tr);

        const state = result?.state || "gray";

        if (state === "gray") {
            tr.classList.add("gg-wagro-gray");
        }

        if (state === "green") {
            tr.classList.add("gg-wagro-green");
        }

        if (state === "orange") {
            tr.classList.add("gg-wagro-orange");
        }

        const td = getProductNameCell(tr);
        if (!td) return;

        const pill = makePill(
            result,
            tr,
            { loading }
        );

        insertPill(td, pill);
    }

    async function fetchProductPageHtml(productUuid) {
        const response = await fetch(
            `/products/view/${productUuid}`,
            {
                credentials: "include",
            }
        );

        if (!response.ok) {
            throw new Error(
                `product page fetch failed: ${response.status}`
            );
        }

        return response.text();
    }

    function extractProductIdFromHtml(html) {
        const match = html.match(
            /\/api\/products\/stock\?[^"'<>]*\bid=(\d+)/i
        );

        return match
            ? parseInt(match[1], 10)
            : null;
    }

    function extractApiTokenFromHtml(html) {
        const match =
            html.match(/api_token:\s*'([^']+)'/i) ||
            html.match(/api_token=([A-Za-z0-9]+)/i);

        return match ? match[1] : null;
    }

    function parsePriorityFromRow(row) {
        if (!row) return null;

        const priority = row.priority;

        if (typeof priority === "number") {
            return priority;
        }

        if (
            priority != null &&
            /^\d+$/.test(String(priority))
        ) {
            return parseInt(priority, 10);
        }

        const html = String(
            row.prio_select || ""
        );

        const match =
            html.match(
                /option\s+value="(\d+)"\s+selected/i
            ) ||
            html.match(
                /option\s+value="(\d+)"\s+selected=""/i
            );

        return match
            ? parseInt(match[1], 10)
            : null;
    }

    function buildStockRequestBody() {
        const cols = [
            {
                data: "picklocation",
                orderable: false,
            },
            {
                data: "free_stock",
                orderable: false,
            },
            {
                data: "total_stock",
                orderable: false,
            },
            {
                data: "min_stock",
                orderable: false,
            },
            {
                data: "max_stock",
                orderable: false,
            },
            {
                data: "warehouse_stockvalue",
                orderable: false,
            },
            {
                data: "priority",
                orderable: true,
            },
            {
                data: "exclude_from_stock",
                orderable: false,
            },
            {
                data: "Actions",
                orderable: false,
            },
        ];

        const params = new URLSearchParams();

        params.set(
            "draw",
            String(
                Math.floor(Date.now() / 1000)
            )
        );

        cols.forEach((col, i) => {
            params.set(
                `columns[${i}][data]`,
                col.data
            );

            params.set(
                `columns[${i}][name]`,
                ""
            );

            params.set(
                `columns[${i}][searchable]`,
                "true"
            );

            params.set(
                `columns[${i}][orderable]`,
                col.orderable
                    ? "true"
                    : "false"
            );

            params.set(
                `columns[${i}][search][value]`,
                ""
            );

            params.set(
                `columns[${i}][search][regex]`,
                "false"
            );
        });

        params.set(
            "order[0][column]",
            "6"
        );

        params.set(
            "order[0][dir]",
            "asc"
        );

        params.set("start", "0");
        params.set("length", "50");

        params.set(
            "search[value]",
            ""
        );

        params.set(
            "search[regex]",
            "false"
        );

        return params.toString();
    }

    async function fetchStockJson(
        productId,
        apiToken
    ) {
        const url =
            `/api/products/stock` +
            `?api_token=${encodeURIComponent(apiToken)}` +
            `&id=${encodeURIComponent(productId)}`;

        const response = await fetch(
            url,
            {
                method: "POST",
                credentials: "include",

                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",

                    "X-Requested-With":
                        "XMLHttpRequest",

                    Accept:
                        "application/json, text/javascript, */*; q=0.01",
                },

                body: buildStockRequestBody(),
            }
        );

        const text =
            await response.text();

        if (!response.ok) {
            throw new Error(
                `stock api ${response.status}: ${text.slice(0, 200)}`
            );
        }

        return JSON.parse(text);
    }

    function computeStateFromStockData(
        productUuid,
        productId,
        apiToken,
        json
    ) {
        const data = Array.isArray(json?.data)
            ? json.data
            : [];

        const rows = data.map((row) => ({
            stockId:
                row.product_stock_id,

            loc:
                row.warehouse_picklocation ||
                row.picklocation ||
                "",

            prio:
                parsePriorityFromRow(row),
        }));

        const wagroRows = rows.filter(
            (row) =>
                wagroRe.test(
                    String(row.loc || "")
                )
        );

        if (!wagroRows.length) {
            return {
                state: "gray",
                wagroPrio: null,
                productUuid,
                productId,
                apiToken,
                rows,
            };
        }

        const priorities =
            wagroRows
                .map((row) => row.prio)
                .filter(
                    (number) =>
                        typeof number ===
                            "number" &&
                        !Number.isNaN(number)
                );

        const wagroPrio =
            priorities.length
                ? Math.min(...priorities)
                : null;

        return {
            state:
                wagroPrio === 1
                    ? "green"
                    : "orange",

            wagroPrio,
            productUuid,
            productId,
            apiToken,
            rows,
        };
    }

    async function computeStateForProduct(
        productUuid
    ) {
        if (cache.has(productUuid)) {
            return cache.get(productUuid);
        }

        if (inFlight.has(productUuid)) {
            return inFlight.get(productUuid);
        }

        const promise = (async () => {
            const html =
                await fetchProductPageHtml(
                    productUuid
                );

            const productId =
                extractProductIdFromHtml(html);

            const apiToken =
                getApiToken() ||
                extractApiTokenFromHtml(html);

            if (
                !apiToken ||
                !productId
            ) {
                const result = {
                    state: "gray",
                    wagroPrio: null,
                    productUuid,
                    productId:
                        productId || null,
                    apiToken:
                        apiToken || null,
                    rows: [],
                };

                cache.set(
                    productUuid,
                    result
                );

                return result;
            }

            const json =
                await fetchStockJson(
                    productId,
                    apiToken
                );

            const result =
                computeStateFromStockData(
                    productUuid,
                    productId,
                    apiToken,
                    json
                );

            cache.set(
                productUuid,
                result
            );

            return result;
        })();

        inFlight.set(
            productUuid,
            promise
        );

        try {
            return await promise;
        } finally {
            inFlight.delete(productUuid);
        }
    }

    async function postChangePrio(
        stockId,
        newPrio,
        csrfToken
    ) {
        const body =
            new URLSearchParams({
                stock_id:
                    String(stockId),

                _token:
                    String(csrfToken),

                new_prio:
                    String(newPrio),
            }).toString();

        const response = await fetch(
            "/picklocations/change_prio",
            {
                method: "POST",
                credentials: "include",

                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",

                    "X-Requested-With":
                        "XMLHttpRequest",

                    Accept:
                        "application/json, text/javascript, */*; q=0.01",
                },

                body,
            }
        );

        const text =
            await response.text();

        if (!response.ok) {
            throw new Error(
                `change_prio ${response.status}: ${text.slice(0, 200)}`
            );
        }

        return true;
    }

    function pickWagroWinner(rows) {
        const wagro = rows.filter(
            (row) =>
                wagroRe.test(
                    String(row.loc || "")
                )
        );

        if (!wagro.length) {
            return null;
        }

        wagro.sort((a, b) => {
            const pa =
                typeof a.prio === "number"
                    ? a.prio
                    : 9999;

            const pb =
                typeof b.prio === "number"
                    ? b.prio
                    : 9999;

            return pa - pb;
        });

        return wagro[0];
    }

    function orderOthers(
        rows,
        winnerStockId
    ) {
        return rows
            .filter(
                (row) =>
                    String(row.stockId) !==
                    String(winnerStockId)
            )
            .sort((a, b) => {
                const pa =
                    typeof a.prio === "number"
                        ? a.prio
                        : 9999;

                const pb =
                    typeof b.prio === "number"
                        ? b.prio
                        : 9999;

                if (pa !== pb) {
                    return pa - pb;
                }

                return String(
                    a.loc || ""
                ).localeCompare(
                    String(b.loc || "")
                );
            });
    }

    async function onFixClick(
        productUuid,
        tr,
        pill
    ) {
        if (!productUuid) return;

        if (
            fixing.has(productUuid)
        ) {
            return;
        }

        fixing.add(productUuid);

        try {
            const csrf =
                getCsrfToken();

            if (!csrf) {
                throw new Error(
                    "Geen CSRF token gevonden."
                );
            }

            const result =
                await computeStateForProduct(
                    productUuid
                );

            if (
                result.state !== "orange"
            ) {
                return;
            }

            if (
                !Array.isArray(
                    result.rows
                ) ||
                !result.rows.length
            ) {
                throw new Error(
                    "Geen stock rows beschikbaar."
                );
            }

            const winner =
                pickWagroWinner(
                    result.rows
                );

            if (!winner) {
                throw new Error(
                    "Geen WaGro locatie gevonden."
                );
            }

            if (pill) {
                pill.textContent =
                    `WaGro prio ${result.wagroPrio ?? "?"} ⏳`;

                pill.setAttribute(
                    "aria-disabled",
                    "true"
                );

                pill.title =
                    "Bezig met aanpassen…";
            }

            const plan = [
                {
                    stockId:
                        winner.stockId,
                    prio: 1,
                },
            ];

            let nextPrio = 2;

            for (
                const row of orderOthers(
                    result.rows,
                    winner.stockId
                )
            ) {
                plan.push({
                    stockId:
                        row.stockId,
                    prio:
                        nextPrio++,
                });
            }

            for (
                const step of plan
            ) {
                await postChangePrio(
                    step.stockId,
                    step.prio,
                    csrf
                );

                await sleep(80);
            }

            const json =
                await fetchStockJson(
                    result.productId,
                    result.apiToken
                );

            const updated =
                computeStateFromStockData(
                    productUuid,
                    result.productId,
                    result.apiToken,
                    json
                );

            cache.set(
                productUuid,
                updated
            );

            setRowState(
                tr,
                updated
            );

        } catch (error) {
            console.warn(
                "[GG WaGro Product Stock List] Fix failed",
                productUuid,
                error
            );

            const cached =
                cache.get(productUuid);

            if (cached) {
                setRowState(
                    tr,
                    cached
                );
            }

        } finally {
            fixing.delete(
                productUuid
            );
        }
    }

    async function processRow(tr) {
        if (
            tr.dataset
                .ggWagroProcessing === "1"
        ) {
            return;
        }

        if (!rowIsTarget(tr)) {
            clearOurDecorations(tr);
            return;
        }

        const productUuid =
            getProductUuid(tr);

        if (!productUuid) {
            return;
        }

        tr.dataset.ggWagroProcessing =
            "1";

        setRowState(
            tr,
            {
                state: "gray",
                wagroPrio: null,
                productUuid,
            },
            {
                loading: true,
            }
        );

        try {
            const result =
                await computeStateForProduct(
                    productUuid
                );

            setRowState(
                tr,
                result
            );

        } catch (error) {
            console.warn(
                "[GG WaGro Product Stock List] Check failed",
                productUuid,
                error
            );

            setRowState(
                tr,
                {
                    state: "gray",
                    wagroPrio: null,
                    productUuid,
                }
            );

        } finally {
            delete tr.dataset
                .ggWagroProcessing;
        }
    }

    async function processRows() {
        injectCssOnce();

        const rows =
            document.querySelectorAll(
                "tr"
            );

        for (const tr of rows) {
            if (
                !tr.querySelector(
                    "td.productNameVal"
                )
            ) {
                continue;
            }

            await processRow(tr);

            await sleep(40);
        }
    }

    let scanTimer = null;

    function scheduleScan() {
        clearTimeout(scanTimer);

        scanTimer = setTimeout(
            processRows,
            100
        );
    }

    // Eerste scan
    processRows();

    // DataTables / AJAX / pagination / filters
    const observer =
        new MutationObserver(
            scheduleScan
        );

    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true,
        }
    );

})();
