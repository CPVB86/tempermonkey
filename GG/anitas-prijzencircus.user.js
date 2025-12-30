// ==UserScript==
// @name         GG | Anita's Prijzencircus
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.7
// @description  Check Anita B2B sale status per kleur en toon een klikbare 🟩 (sale) of ⬛ (normaal) bij Anita/Rosa Faia met locatie 00. Extern, met koll-prefix support
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

    function buildSaleUrl(arnr, fbnr, vakn, koll) {
        return `https://b2b.anita.com/nl/shop/441/?fssc=N&vsas=&koll=${encodeURIComponent(
            koll || ''
        )}&form=&vacp=&arnr=${encodeURIComponent(
            arnr
        )}&vakn=${encodeURIComponent(vakn)}&sicht=V&fbnr=${encodeURIComponent(fbnr)}`;
    }

    function buildNormalUrl(arnr, fbnr, koll) {
        return `https://b2b.anita.com/nl/shop/441/?fssc=N&vsas=&koll=${encodeURIComponent(
            koll || ''
        )}&form=&vacp=&arnr=${encodeURIComponent(
            arnr
        )}&vakn=&sicht=A&fbnr=${encodeURIComponent(fbnr || '')}`;
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

            const marker = createMarker(titleLink);

            // 1) Probeer prefix + artikelnummer: M5 7811-186 of M5-7811-186
            let koll = '';
            let arnr = '';
            let fbnr = '';

            let m = titleText.match(/([A-Za-z0-9]{2})\s*[- ]?(\d{4})-(\d{3})/);
            if (m) {
                koll = m[1].toUpperCase();
                arnr = m[2];
                fbnr = m[3];
            } else {
                // 2) Fallback: alleen artikel + kleur: 1627-186
                const matchSimple = titleText.match(/(\d{4})-(\d{3})/);
                if (matchSimple) {
                    arnr = matchSimple[1];
                    fbnr = matchSimple[2];
                }
            }

            if (!arnr) {
                // Geen bruikbaar artikelnummer → probeer nog een generieke 4-digit match voor normale URL
                const artMatch = titleText.match(/(\d{4})/);
                if (artMatch) {
                    const arnrOnly = artMatch[1];
                    const normalUrl = buildNormalUrl(arnrOnly, '', koll);
                    setMarkerLink(marker, '⬛', normalUrl);
                } else {
                    setMarkerPlain(marker, '⬛');
                }
                row.dataset.anitaSaleChecked = '1';
                return;
            }

            setMarkerPlain(marker, '…'); // bezig met checken
            row.dataset.anitaSaleChecked = '1';

            checkSaleStatus(arnr, fbnr, koll, marker);
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
        // 1) Afbeelding met kleurnummer, zoals .../color/186.jpg
        const colorImgs = doc.querySelectorAll('img[src*="/color/"]');
        for (const img of colorImgs) {
            const src = img.getAttribute('src') || '';
            if (src.includes(`/${fbnr}.`)) {
                return true;
            }
        }

        // 2) Directe ID-match
        const variantId = `article-variant-${arnr}-${fbnr}-accordion-heading`;
        if (doc.getElementById(variantId)) {
            return true;
        }

        // 3) Headers / knoppen met kleurcode
        const headers = doc.querySelectorAll('h2.accordion-header, .accordion-button, [id*="article-variant-"]');
        const wordRegex = new RegExp(`\\b${fbnr}\\b`);
        for (const el of headers) {
            const id = el.id || '';
            const txt = (el.textContent || '').trim();

            if (id.includes(`-${fbnr}-`)) {
                return true;
            }
            if (txt.startsWith(fbnr + ' ') || txt === fbnr || wordRegex.test(txt)) {
                return true;
            }
        }

        // 4) Laatste redmiddel: volledige tekst
        if (wordRegex.test(fullText)) {
            return true;
        }

        return false;
    }

    function checkSaleStatus(arnr, fbnr, koll, marker) {
        let index = 0;

        function tryNextVakn() {
            if (index >= VAKN_LIST.length) {
                // Geen sale-variant gevonden → zwarte ⬛, klikbaar naar normale productpagina
                const normalUrl = buildNormalUrl(arnr, fbnr, koll);
                setMarkerLink(marker, '⬛', normalUrl);
                return;
            }

            const vakn = VAKN_LIST[index++];
            const url = buildSaleUrl(arnr, fbnr, vakn, koll);

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                onload: function (response) {
                    const status = response.status;
                    const text = response.responseText || '';

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
                        // Exacte kleurvariant in deze sale-categorie → groene klikbare blok
                        setMarkerLink(marker, '🟩', url);
                    } else {
                        // Volgende vakn proberen
                        tryNextVakn();
                    }
                },
                onerror: function () {
                    tryNextVakn();
                }
            });
        }

        tryNextVakn();
    }

    processRows();

    const observerTarget = document.getElementById('local_data') || document.body;
    const observer = new MutationObserver(() => {
        processRows();
    });

    observer.observe(observerTarget, {
        childList: true,
        subtree: true
    });
})();
