// ==UserScript==
// @name         GG | Anita's Prijzencircus
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.5
// @description  Check Anita B2B sale status per kleur en toon een klikbare 🟩 (sale) of ⬛ (normaal) bij Anita/Rosa Faia met locatie 00. Extern
// @match        https://fm-e-warehousing.goedgepickt.nl/orders/view/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      b2b.anita.com
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/anitas-prijzencircus.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/anitas-prijzencircus.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VAKN_LIST = ['SVCO70', 'SVCO50', 'SVCO30', 'SVBA50', 'SVBA30'];

    function buildSaleUrl(arnr, fbnr, vakn) {
        // Sale-URL voor specifieke vakn
        return `https://b2b.anita.com/nl/shop/441/?fssc=N&vsas=&koll=&form=&vacp=&arnr=${encodeURIComponent(
            arnr
        )}&vakn=${encodeURIComponent(vakn)}&sicht=V&fbnr=${encodeURIComponent(fbnr)}`;
    }

    function buildNormalUrl(arnr, fbnr) {
        // Niet-sale productoverzicht
        return `https://b2b.anita.com/nl/shop/441/?fssc=N&vsas=&koll=&form=&vacp=&arnr=${encodeURIComponent(
            arnr
        )}&vakn=&sicht=A&fbnr=${encodeURIComponent(fbnr)}`;
    }

    function injectStyles() {
        if (document.getElementById('anita-sale-check-styles')) return;
        const style = document.createElement('style');
        style.id = 'anita-sale-check-styles';
        style.textContent = `
            .anita-sale-marker {
                margin-left: 4px;
                font-weight: bold;
            }
            .anita-sale-link {
                text-decoration: none !important;
                cursor: pointer;
                font-weight: bold;
            }
            .anita-sale-link:hover {
                opacity: 0.8;
            }
            .anita-login-pill {
                display: inline-block;
                margin-left: 6px;
                padding: 2px 8px;
                border-radius: 999px;
                background: #000;
                color: #fff !important;
                font-size: 11px;
                text-decoration: none !important;
            }
            .anita-login-pill:hover {
                opacity: 0.8;
            }
        `;
        document.head.appendChild(style);
    }

    function processRows() {
        injectStyles();

        const rows = document.querySelectorAll('table.table tbody tr.normal');

        rows.forEach(row => {
            if (row.dataset.anitaSaleChecked === '1') return;

            const titleLink = row.querySelector('.productDataTd a[data-product-uuid]');
            if (!titleLink) return;

            const titleText = (titleLink.textContent || '').trim();
            const isAnitaOrRosa = /anita|rosa faia/i.test(titleText);
            if (!isAnitaOrRosa) return;

            const locSpans = row.querySelectorAll('td.productPicklocation .stockLocationName');
            let hasExtern00 = false;
            locSpans.forEach(span => {
                const txt = (span.textContent || '').trim();
                if (txt.includes('00. Extern')) {
                    hasExtern00 = true;
                }
            });
            if (!hasExtern00) return;

            // Haal artikelnummer en kleurnummer uit titel: 1627-186
            const match = titleText.match(/(\d{4})-(\d{3})/);
            const marker = createMarker(titleLink);

            if (!match) {
                // Geen arnr/fbnr herkenbaar → zwarte ⬛ zonder link (we weten niet waarheen)
                setMarkerPlain(marker, '⬛');
                row.dataset.anitaSaleChecked = '1';
                return;
            }

            const arnr = match[1];
            const fbnr = match[2];

            // Laat alvast zien dat we bezig zijn
            setMarkerPlain(marker, '…');
            row.dataset.anitaSaleChecked = '1';

            checkSaleStatus(arnr, fbnr, marker);
        });
    }

    function createMarker(titleLink) {
        let marker = titleLink.parentElement.querySelector('.anita-sale-marker');
        if (!marker) {
            marker = document.createElement('span');
            marker.className = 'anita-sale-marker';
            titleLink.insertAdjacentElement('afterend', marker);
        }
        return marker;
    }

    function setMarkerPlain(marker, symbol) {
        marker.textContent = ' ' + symbol;
    }

    function setMarkerLink(marker, symbol, url) {
        marker.textContent = '';
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.className = 'anita-sale-link';
        a.textContent = ' ' + symbol;
        marker.appendChild(a);
    }

    function replaceWithLoginPill(marker) {
        const parent = marker.parentElement;
        if (!parent) return;

        marker.remove();

        const link = document.createElement('a');
        link.href = 'https://b2b.anita.com/';
        link.target = '_blank';
        link.textContent = 'Inloggen bij b2b';
        link.className = 'anita-login-pill';
        parent.appendChild(link);
    }

    function hasVariantForColor(doc, arnr, fbnr, fullText) {
        // 1) Directe ID-match
        const variantId = `article-variant-${arnr}-${fbnr}-accordion-heading`;
        if (doc.getElementById(variantId)) {
            return true;
        }

        // 2) In accordion headers / buttons
        const headers = doc.querySelectorAll('h2.accordion-header, .accordion-button, [id*="article-variant-"]');
        for (const el of headers) {
            const id = el.id || '';
            const txt = (el.textContent || '').trim();

            if (id.includes(`-${fbnr}-`)) {
                return true;
            }

            // bv. "186 red/blue iris"
            if (txt.startsWith(fbnr + ' ') || txt === fbnr) {
                return true;
            }

            const wordRegex = new RegExp(`\\b${fbnr}\\b`);
            if (wordRegex.test(txt)) {
                return true;
            }
        }

        // 3) Laatste redmiddel: hele tekst
        const globalWordRegex = new RegExp(`\\b${fbnr}\\b`);
        if (globalWordRegex.test(fullText)) {
            return true;
        }

        return false;
    }

    function checkSaleStatus(arnr, fbnr, marker) {
        let index = 0;

        function tryNextVakn() {
            if (index >= VAKN_LIST.length) {
                // Geen enkele sale-pagina bevat deze kleurvariant → zwarte ⬛, klikbaar naar normale productpagina
                const normalUrl = buildNormalUrl(arnr, fbnr);
                setMarkerLink(marker, '⬛', normalUrl);
                return;
            }

            const vakn = VAKN_LIST[index++];
            const url = buildSaleUrl(arnr, fbnr, vakn);

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                onload: function (response) {
                    const status = response.status;
                    const text = response.responseText || '';

                    // Login-detectie: status 401/403 of een password-veld
                    const looksLikeLogin =
                        status === 401 ||
                        status === 403 ||
                        /type=["']password["']/i.test(text);

                    if (looksLikeLogin) {
                        replaceWithLoginPill(marker);
                        return;
                    }

                    let hasVariant = false;
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(text, 'text/html');
                        hasVariant = hasVariantForColor(doc, arnr, fbnr, text);
                    } catch (e) {
                        console.debug('[Anita Sale Check] Parse error:', e);
                    }

                    if (hasVariant) {
                        // Deze vakn-pagina bevat precies onze kleurvariant → groene klikbare blok
                        setMarkerLink(marker, '🟩', url);
                    } else {
                        // Variant niet gevonden in deze sale-categorie → volgende vakn proberen
                        tryNextVakn();
                    }
                },
                onerror: function () {
                    // Bij fout naar volgende vakn
                    tryNextVakn();
                }
            });
        }

        tryNextVakn();
    }

    // Eerste run
    processRows();

    // Observer voor dynamische updates
    const observerTarget = document.getElementById('local_data') || document.body;
    const observer = new MutationObserver(() => {
        processRows();
    });

    observer.observe(observerTarget, {
        childList: true,
        subtree: true
    });
})();
