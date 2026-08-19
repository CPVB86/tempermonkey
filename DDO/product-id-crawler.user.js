// ==UserScript==
// @name         DDO | Product ID crawler
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      1.2.0
// @description  Crawlt alle productpagina's en kopieert alle product-ID's regel voor regel.
// @author       C. P. v. Beek
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/product-id-crawler.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/product-id-crawler.user.js
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    console.log('[DDO Product ID crawler] Script gestart');

    /******************************************************************
     * INSTELLINGEN
     ******************************************************************/

    // Ruim hoger dan de huidige ±299 pagina's.
    // Normaal stopt het script vanzelf bij de eerste lege productpagina.
    const MAX_PAGE = 2000;

    // Aantal pagina's dat tegelijk wordt opgehaald.
    const CONCURRENCY = 6;

    // Bij een fout opnieuw proberen.
    const MAX_RETRIES = 3;

    const RETRY_DELAY_MS = 500;


    /******************************************************************
     * STATE
     ******************************************************************/

    let running = false;
    let stopRequested = false;

    let nextPageToFetch = 1;
    let nextPageToProcess = 1;

    let activeRequests = 0;
    let startedAt = 0;

    let emptyPage = null;

    const pageResults = new Map();

    const collectedIds = [];
    const seenIds = new Set();


    /******************************************************************
     * UI
     ******************************************************************/

    function createUI() {
        if (document.getElementById('ddo-product-id-crawler')) {
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'ddo-product-id-crawler';

        panel.style.cssText = `
            position: fixed !important;
            right: 20px !important;
            bottom: 20px !important;
            z-index: 2147483647 !important;
            width: 350px !important;
            padding: 15px !important;
            background: #111 !important;
            color: #fff !important;
            border: 2px solid #fff !important;
            border-radius: 10px !important;
            box-shadow: 0 4px 20px rgba(0,0,0,.45) !important;
            font-family: Arial, sans-serif !important;
            font-size: 13px !important;
            line-height: 1.45 !important;
            box-sizing: border-box !important;
        `;

        panel.innerHTML = `
            <div style="
                font-size:16px;
                font-weight:bold;
                margin-bottom:10px;
            ">
                DDO Product ID crawler
            </div>

            <div id="ddo-crawler-status" style="
                margin-bottom:12px;
                min-height:70px;
            ">
                Klaar om te starten.
            </div>

            <div style="
                display:flex;
                gap:7px;
                flex-wrap:wrap;
            ">
                <button id="ddo-crawler-start" type="button">
                    ▶ Start
                </button>

                <button id="ddo-crawler-stop" type="button" disabled>
                    ■ Stop + kopiëren
                </button>

                <button id="ddo-crawler-copy" type="button" disabled>
                    📋 Kopieer
                </button>
            </div>
        `;

        document.body.appendChild(panel);

        const buttons = panel.querySelectorAll('button');

        buttons.forEach(button => {
            button.style.cssText = `
                border: 0 !important;
                border-radius: 6px !important;
                padding: 8px 11px !important;
                cursor: pointer !important;
                color: #fff !important;
                font-weight: bold !important;
                font-size: 12px !important;
            `;
        });

        document.getElementById('ddo-crawler-start').style.background = '#28a745';
        document.getElementById('ddo-crawler-stop').style.background = '#dc3545';
        document.getElementById('ddo-crawler-copy').style.background = '#007bff';

        document
            .getElementById('ddo-crawler-start')
            .addEventListener('click', startCrawl);

        document
            .getElementById('ddo-crawler-stop')
            .addEventListener('click', stopCrawl);

        document
            .getElementById('ddo-crawler-copy')
            .addEventListener('click', copyResults);

        updateButtons();

        console.log('[DDO Product ID crawler] Paneel toegevoegd');
    }


    function getStatusEl() {
        return document.getElementById('ddo-crawler-status');
    }


    function updateButtons() {
        const start = document.getElementById('ddo-crawler-start');
        const stop = document.getElementById('ddo-crawler-stop');
        const copy = document.getElementById('ddo-crawler-copy');

        if (!start || !stop || !copy) {
            return;
        }

        start.disabled = running;
        stop.disabled = !running;
        copy.disabled = collectedIds.length === 0;

        start.style.opacity = start.disabled ? '.5' : '1';
        stop.style.opacity = stop.disabled ? '.5' : '1';
        copy.style.opacity = copy.disabled ? '.5' : '1';
    }


    function updateStatus(extra = '') {
        const el = getStatusEl();

        if (!el) {
            return;
        }

        let html = '';

        if (running) {
            html += '<strong>Bezig…</strong><br>';
        } else if (collectedIds.length) {
            html += '<strong>Klaar / gestopt</strong><br>';
        } else {
            html += '<strong>Klaar om te starten</strong><br>';
        }

        html += `Laatste complete pagina: <strong>${Math.max(0, nextPageToProcess - 1)}</strong><br>`;
        html += `Product ID's: <strong>${collectedIds.length}</strong><br>`;

        if (running) {
            html += `Requests actief: <strong>${activeRequests}</strong><br>`;
        }

        if (emptyPage !== null) {
            html += `Eerste lege pagina: <strong>${emptyPage}</strong><br>`;
        }

        if (startedAt) {
            const seconds = Math.round(
                (Date.now() - startedAt) / 1000
            );

            html += `Tijd: <strong>${seconds}s</strong>`;
        }

        if (extra) {
            html += `
                <div style="
                    margin-top:8px;
                    color:#ffd966;
                ">
                    ${extra}
                </div>
            `;
        }

        el.innerHTML = html;

        updateButtons();
    }


    /******************************************************************
     * HELPERS
     ******************************************************************/

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    function resetState() {
        stopRequested = false;

        nextPageToFetch = 1;
        nextPageToProcess = 1;

        activeRequests = 0;
        emptyPage = null;

        pageResults.clear();

        collectedIds.length = 0;
        seenIds.clear();

        startedAt = Date.now();
    }


    function getPageUrl(page) {
        return (
            window.location.origin +
            '/admin.php?section=products&page=' +
            encodeURIComponent(page)
        );
    }


    /******************************************************************
     * HTML CONTROLEREN
     ******************************************************************/

    function analysePage(html, page) {
        const ids = extractProductIds(html);

        /*
         * Producten gevonden?
         * Dan is alles sowieso goed.
         */
        if (ids.length > 0) {
            return {
                type: 'products',
                ids: ids
            };
        }


        /*
         * Nul producten.
         *
         * Nu moeten we bepalen:
         *
         * A. echte lege productlijst
         *
         * of
         *
         * B. loginpagina / foutpagina / Cloudflare / vreemde response.
         */


        const lower = html.toLowerCase();


        // Zeer waarschijnlijke login response.
        const looksLikeLogin =
            lower.includes('type="password"') ||
            lower.includes("type='password'") ||
            lower.includes('name="password"') ||
            lower.includes("name='password'") ||
            lower.includes('login') && lower.includes('password');


        if (looksLikeLogin) {
            return {
                type: 'invalid',
                reason: 'De server lijkt een loginpagina terug te geven.'
            };
        }


        // Cloudflare / challenge.
        const looksLikeCloudflare =
            lower.includes('cf-chl-') ||
            lower.includes('cloudflare') && lower.includes('challenge');

        if (looksLikeCloudflare) {
            return {
                type: 'invalid',
                reason: 'De server lijkt een Cloudflare/challenge-pagina terug te geven.'
            };
        }


        /*
         * Kijken of dit überhaupt op de productenlijst lijkt.
         *
         * We gebruiken meerdere kenmerken omdat één specifiek
         * stukje HTML in het CMS ooit kan veranderen.
         */
        const looksLikeProductList =
            html.includes('section=products') ||
            html.includes('name="products[]"') ||
            html.includes("name='products[]'") ||
            html.includes('filter=category_id') ||
            html.includes('filter=type_id');


        if (!looksLikeProductList) {
            console.warn(
                `[DDO crawler] Pagina ${page} lijkt niet op een productlijst.`
            );

            console.log(
                `[DDO crawler] Begin response pagina ${page}:`,
                html.substring(0, 2000)
            );

            return {
                type: 'invalid',
                reason: 'De opgehaalde HTML lijkt niet op de productenlijst.'
            };
        }


        /*
         * We hebben geen ID's, maar de pagina lijkt wel degelijk
         * bij section=products te horen.
         *
         * Dat behandelen we als lege productpagina.
         */
        return {
            type: 'empty',
            ids: []
        };
    }


    /******************************************************************
     * PRODUCT ID'S UITLEZEN
     ******************************************************************/

    function extractProductIds(html) {
        const ids = [];
        const localSeen = new Set();

        let match;


        /*
         * ============================================================
         * METHODE 1
         *
         * Checkbox zoals:
         *
         * <input
         *   type="checkbox"
         *   name="products[]"
         *   value="48535"
         * >
         * ============================================================
         */

        const inputRegex =
            /<input\b[^>]*\bname\s*=\s*["']products\[\]["'][^>]*\bvalue\s*=\s*["'](\d+)["'][^>]*>/gi;

        while ((match = inputRegex.exec(html)) !== null) {
            const id = match[1];

            if (!localSeen.has(id)) {
                localSeen.add(id);
                ids.push(id);
            }
        }


        /*
         * Attributen kunnen ook andersom staan:
         *
         * value="48535" name="products[]"
         */

        const reverseInputRegex =
            /<input\b[^>]*\bvalue\s*=\s*["'](\d+)["'][^>]*\bname\s*=\s*["']products\[\]["'][^>]*>/gi;

        while ((match = reverseInputRegex.exec(html)) !== null) {
            const id = match[1];

            if (!localSeen.has(id)) {
                localSeen.add(id);
                ids.push(id);
            }
        }


        /*
         * ============================================================
         * METHODE 2
         *
         * Edit URL:
         *
         * admin.php?section=products&action=edit&id=48535
         *
         * of in HTML:
         *
         * admin.php?section=products&amp;action=edit&amp;id=48535
         * ============================================================
         */

        const editRegex =
            /admin\.php\?section=products(?:&|&amp;)action=edit(?:&|&amp;)id=(\d+)/gi;

        while ((match = editRegex.exec(html)) !== null) {
            const id = match[1];

            if (!localSeen.has(id)) {
                localSeen.add(id);
                ids.push(id);
            }
        }


        /*
         * ============================================================
         * METHODE 3
         *
         * onmousedown:
         *
         * Goto('admin.php?section=products&amp;action=edit&amp;id=48535')
         *
         * Methode 2 vangt dit normaal al af.
         * Deze regex is extra fallback.
         * ============================================================
         */

        const looseIdRegex =
            /section=products(?:&|&amp;)action=edit(?:&|&amp;)id=(\d+)/gi;

        while ((match = looseIdRegex.exec(html)) !== null) {
            const id = match[1];

            if (!localSeen.has(id)) {
                localSeen.add(id);
                ids.push(id);
            }
        }


        console.log(
            `[DDO crawler] ${ids.length} unieke product-ID's uit response gehaald`
        );

        return ids;
    }


    /******************************************************************
     * PAGINA OPHALEN
     ******************************************************************/

    async function fetchPage(page) {
        const url = getPageUrl(page);

        let lastError = null;

        for (
            let attempt = 1;
            attempt <= MAX_RETRIES;
            attempt++
        ) {
            if (stopRequested) {
                return null;
            }

            try {
                const response = await fetch(url, {
                    method: 'GET',

                    credentials: 'same-origin',

                    cache: 'no-store',

                    headers: {
                        'Accept':
                            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                });


                if (!response.ok) {
                    throw new Error(
                        `HTTP ${response.status} ${response.statusText}`
                    );
                }


                const html = await response.text();


                /*
                 * DEBUG pagina 1.
                 *
                 * Zo kunnen we in de console zien wat fetch()
                 * daadwerkelijk teruggeeft.
                 */
                if (page === 1) {
                    console.log(
                        '[DDO crawler] Pagina 1 response lengte:',
                        html.length
                    );

                    console.log(
                        '[DDO crawler] Eerste 2000 tekens pagina 1:',
                        html.substring(0, 2000)
                    );
                }


                return html;

            } catch (error) {
                lastError = error;

                console.warn(
                    `[DDO crawler] Pagina ${page}, poging ${attempt}/${MAX_RETRIES} mislukt:`,
                    error
                );


                if (attempt < MAX_RETRIES) {
                    await sleep(
                        RETRY_DELAY_MS * attempt
                    );
                }
            }
        }


        throw lastError;
    }


    /******************************************************************
     * RESULTATEN OP PAGINAVOLGORDE VERWERKEN
     ******************************************************************/

    function processAvailablePages() {
        while (
            running &&
            pageResults.has(nextPageToProcess)
        ) {
            const page = nextPageToProcess;

            const result = pageResults.get(page);

            pageResults.delete(page);


            /*
             * ========================================================
             * ONGELDIGE RESPONSE
             * ========================================================
             */

            if (result.type === 'invalid') {
                console.error(
                    `[DDO crawler] Pagina ${page}: ${result.reason}`
                );

                finishCrawl(
                    `⚠️ Pagina ${page}: ${result.reason} Crawl gestopt.`
                );

                return;
            }


            /*
             * ========================================================
             * ECHT LEGE PAGINA
             * ========================================================
             */

            if (result.type === 'empty') {
                emptyPage = page;

                console.log(
                    `[DDO crawler] Pagina ${page} is de eerste lege productpagina.`
                );

                finishCrawl(
                    `✅ Pagina ${page} bevat geen producten. Einde bereikt.`
                );

                return;
            }


            /*
             * ========================================================
             * PRODUCTEN
             * ========================================================
             */

            const ids = result.ids;


            for (const id of ids) {
                if (!seenIds.has(id)) {
                    seenIds.add(id);
                    collectedIds.push(id);
                }
            }


            console.log(
                `[DDO crawler] Pagina ${page}: ` +
                `${ids.length} ID's | ` +
                `totaal ${collectedIds.length}`
            );


            nextPageToProcess++;

            updateStatus();
        }
    }


    /******************************************************************
     * WORKER
     ******************************************************************/

    async function worker(workerId) {
        while (
            running &&
            !stopRequested
        ) {
            const page = nextPageToFetch++;


            if (page > MAX_PAGE) {
                finishCrawl(
                    `Veiligheidslimiet van ${MAX_PAGE} pagina's bereikt.`
                );

                return;
            }


            activeRequests++;

            updateStatus();


            try {
                const html = await fetchPage(page);


                if (
                    !running ||
                    stopRequested ||
                    html === null
                ) {
                    return;
                }


                const result = analysePage(
                    html,
                    page
                );


                if (result.type === 'products') {
                    console.log(
                        `[DDO crawler] Worker ${workerId} → pagina ${page}: ${result.ids.length} producten`
                    );
                } else {
                    console.log(
                        `[DDO crawler] Worker ${workerId} → pagina ${page}: ${result.type}`
                    );
                }


                /*
                 * Opslaan onder paginanummer.
                 *
                 * Hierdoor kunnen de requests razendsnel parallel lopen,
                 * maar verwerken we de resultaten alsnog exact:
                 *
                 * 1 → 2 → 3 → 4 → ...
                 */
                pageResults.set(
                    page,
                    result
                );


                processAvailablePages();

            } catch (error) {
                console.error(
                    `[DDO crawler] Pagina ${page} definitief mislukt:`,
                    error
                );


                finishCrawl(
                    `❌ Pagina ${page} kon na ${MAX_RETRIES} pogingen niet worden geladen. ` +
                    `Crawl gestopt om geen producten over te slaan.`
                );


                return;

            } finally {
                activeRequests = Math.max(
                    0,
                    activeRequests - 1
                );

                updateStatus();
            }
        }
    }


    /******************************************************************
     * START
     ******************************************************************/

    async function startCrawl() {
        if (running) {
            return;
        }


        resetState();


        running = true;
        stopRequested = false;


        updateStatus(
            `Gestart met ${CONCURRENCY} gelijktijdige requests.`
        );


        console.log(
            `[DDO crawler] Crawl gestart met ${CONCURRENCY} workers`
        );


        const workers = [];


        for (
            let i = 1;
            i <= CONCURRENCY;
            i++
        ) {
            workers.push(
                worker(i)
            );
        }


        await Promise.allSettled(workers);


        /*
         * Normaal wordt finishCrawl() al aangeroepen
         * door een lege pagina, fout of stopactie.
         */
        if (running) {
            finishCrawl(
                'Crawl afgerond.'
            );
        }
    }


    /******************************************************************
     * HANDMATIG STOPPEN
     ******************************************************************/

    function stopCrawl() {
        if (!running) {
            return;
        }


        console.log(
            '[DDO crawler] Handmatige stop aangevraagd'
        );


        stopRequested = true;
        running = false;


        updateStatus(
            '■ Handmatig gestopt.'
        );


        if (collectedIds.length > 0) {
            copyResults();
        }
    }


    /******************************************************************
     * AFRONDEN
     ******************************************************************/

    function finishCrawl(message = '') {
        if (!running && stopRequested) {
            updateStatus(message);
            return;
        }


        running = false;
        stopRequested = true;


        updateStatus(message);


        console.log(
            `[DDO crawler] Crawl beëindigd. ${collectedIds.length} unieke ID's verzameld.`
        );


        if (collectedIds.length > 0) {
            copyResults();
        }
    }


    /******************************************************************
     * KLEMBORD
     ******************************************************************/

    function copyResults() {
        if (collectedIds.length === 0) {
            updateStatus(
                "Geen Product ID's om te kopiëren."
            );

            return;
        }


        /*
         * Letterlijk:
         *
         * 48535
         * 48534
         * 48533
         * ...
         */
        const text = collectedIds.join('\n');


        try {
            GM_setClipboard(
                text,
                'text'
            );


            console.log(
                `[DDO crawler] ${collectedIds.length} ID's naar klembord gekopieerd`
            );


            updateStatus(
                `✅ ${collectedIds.length} Product ID's staan op het klembord.`
            );

        } catch (error) {
            console.warn(
                '[DDO crawler] GM_setClipboard mislukt, browser fallback proberen.',
                error
            );


            navigator.clipboard
                .writeText(text)
                .then(() => {
                    updateStatus(
                        `✅ ${collectedIds.length} Product ID's staan op het klembord.`
                    );
                })
                .catch(err => {
                    console.error(
                        '[DDO crawler] Klembord mislukt:',
                        err
                    );


                    updateStatus(
                        '❌ Kon de resultaten niet naar het klembord kopiëren.'
                    );
                });
        }
    }


    /******************************************************************
     * INITIALISEREN
     ******************************************************************/

    if (document.body) {
        createUI();
    } else {
        window.addEventListener(
            'DOMContentLoaded',
            createUI,
            { once: true }
        );
    }

})();
