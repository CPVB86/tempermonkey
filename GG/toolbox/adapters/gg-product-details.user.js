// ==UserScript==
// @name         GG Toolbox | Adapter | Product Details
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.1.3
// @description  Check Anita B2B sale status per kleur en toon een klikbare 🟩 (sale) of ⬛ (normaal) bij Anita/Rosa Faia met locatie 00. Extern, met koll-support en badmode-voorkeur.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      b2b.anita.com
// @author       Chantor van Beek
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-product-details.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-product-details.user.js
// ==/UserScript==

(function () {
    'use strict';

    const window = unsafeWindow;
    if (window.__ggAnitaSale) return;
    window.__ggAnitaSale = { version: '1.1.3' };
    const allowed = () => /^\/orders\/view\//.test(location.pathname) && window.__ggToolbox?.isEnabled('productDetails') === true;

    function buildSaleUrl(arnr, fbnr, vakn, koll) {
        return `https://b2b.anita.com/nl/shop/441/?fssc=N&vsas=&koll=${encodeURIComponent(
            koll || ''
        )}&form=&vacp=&arnr=${encodeURIComponent(
            arnr
        )}&vakn=${encodeURIComponent(vakn)}&sicht=V&fbnr=${encodeURIComponent(fbnr || '')}`;
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
                font-weight: 400;
            }
            .anita-sale-link {
                text-decoration: none !important;
                cursor: pointer;
                font-weight: 400;
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

    // Parseert koll / artikel / kleur uit de titel
    // Voorbeelden die werken:
    // - "M5-8890-1-765"   -> koll=M5,   arnr=8890-1, fbnr=765
    // - "M5 7811-186"     -> koll=M5,   arnr=7811,   fbnr=186
    // - "4761X-408"       -> koll='',   arnr=4761X,  fbnr=408
    // - "8890-1-765"      -> koll='',   arnr=8890-1, fbnr=765
    // - "7811-186"        -> koll='',   arnr=7811,   fbnr=186
    function parseAnitaCode(titleText) {
        let koll = '';
        let arnr = '';
        let fbnr = '';

        // Hoofdpatroon: optionele koll (2 tekens) + 4 cijfers + optionele letter + optionele "-1" + "-kleur"
        const mainRe = /(?:\b([A-Za-z0-9]{2})\s*[- ]*)?([0-9]{4}[A-Za-z]?(?:-\d)?)-(\d{3})/;
        const m = titleText.match(mainRe);

        if (!m) {
            return { koll, arnr, fbnr };
        }

        let kollCandidate = (m[1] || '').toUpperCase();
        arnr = m[2];
        fbnr = m[3];

        // Koll is alleen geldig als het 2 tekens zijn met MINSTENS 1 letter én 1 cijfer (zoals M5, A3, V2)
        if (
            /^[A-Z0-9]{2}$/.test(kollCandidate) &&
            /[A-Z]/.test(kollCandidate) &&
            /\d/.test(kollCandidate)
        ) {
            koll = kollCandidate;
        } else {
            koll = '';
        }

        return { koll, arnr, fbnr };
    }


    function supplierDetails(productName) {
        const name = String(productName || '').replace(/\s+/g, ' ').trim();
        // Only the supplier-code segment immediately before [ext].
        const match = name.match(/ - ([^]*?) - \[ext\]/i);
        if (!match) return null;
        let id = match[1].split(' - ').pop().trim();
        let base = '';
        if (/\b(?:pastunette|rebelle|robson|ringella|mundo|muchacho\w*|chicamala)\b/i.test(name)) return null;
        // Anita/Rosa Faia gebruiken uitsluitend de link van de salechecker.
        if (/\b(?:anita|rosa\s+faia)\b/i.test(name)) return null;
        if (/^(?:chantelle|femilet)\b/i.test(name)) base = 'https://chantelle-lingerie.my.site.com/DefaultStore/ccrz__ProductDetails?sku=';
        else if (/\bafter\s+eden\b/i.test(name)) { base = 'https://bcg.fashionportal.shop/item/'; id = id.replace(/[^a-z0-9]/gi, ''); }
        else if (/\bmey\b/i.test(name)) { base = 'https://meyb2b.com/d-reorder-mey/search/products/'; id = id.split('-')[0].trim(); }
        else if (/\b(?:wacoal|freya|fantasie|elomi)\b/i.test(name)) base = 'https://b2b.wacoal-europe.com/b2b/en/EUR/search/?text=';
        else if (/\blisca\b/i.test(name)) { base = 'https://b2b-eu.lisca.com/catalogsearch/result/?q='; id = id.split('-')[0].trim(); }
        else if (/\btriumph\b/i.test(name)) base = 'https://b2b.triumph.com/products/NL_TriumphPROD?search=';
        else if (/\bsloggi\b/i.test(name)) base = 'https://b2b.triumph.com/products/NL_sloggiPROD?search=';
        else if (/\blingadore\b/i.test(name)) base = 'https://b2b.lingadore.com/nl/catalog/item/';
        else if (/\bsugar\s*candy\b/i.test(name)) base = 'https://b2b.cakelingerie.eu/search?controller=search&s=';
        else if (/\b(?:charlie\s+choe|mila)\b/i.test(name)) { base = 'https://vangennip.itsperfect.it/webshop/search/'; id = id.split('-').slice(0, 2).join('-'); }
        return base && id ? { id, url:base + encodeURIComponent(id) } : null;
    }
    function addSupplierLinks() {
        for (const row of document.querySelectorAll('tr.normal')) {
            const anchor = row.querySelector('td[data-field="picture"] a[data-product-uuid],.productDataTd a[data-product-uuid]');
            const detail = anchor ? supplierDetails(anchor.textContent) : null;
            const existing = row.querySelector('.gg-order-me-ext-link');
            if (!detail) { existing?.remove(); continue; }
            if (existing?.getAttribute('href') === detail.url) continue;
            existing?.remove();
            const link = document.createElement('a');
            link.href = detail.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
            link.title = 'Open leverancier (' + detail.id + ')'; link.setAttribute('aria-label', link.title);
            link.className = 'gg-order-me-ext-link';
            link.style.cssText = 'display:inline-flex;vertical-align:middle;margin-left:4px;color:#0877b9';
            link.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/></svg>';
            link.onclick = event => { if (!allowed()) event.preventDefault(); };
            anchor.insertAdjacentElement('afterend', link);
        }
    }

    function processRows() {
        if (!allowed()) {
            document.querySelectorAll('.anita-sale-marker,.anita-login-pill,.gg-order-me-ext-link').forEach(el => el.remove());
            document.querySelectorAll('[data-anita-sale-checked]').forEach(row => delete row.dataset.anitaSaleChecked);
            return;
        }
        addSupplierLinks();
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

            // Swim/badmode-detectie
            const isSwim = /badmode|swim|bikini|tankini/i.test(titleText);

            const { koll, arnr, fbnr } = parseAnitaCode(titleText);

            if (!arnr) {
                // laatste fallback: alleen een 4-cijferig artikelnummer (met optionele letter) gebruiken
                const artMatch = titleText.match(/(\d{4}[A-Za-z]?)/);
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

            checkSaleStatus(arnr, fbnr, koll, marker, isSwim);
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
        if (!allowed() || !marker.isConnected) return;
        marker.textContent = ' ' + symbol;
    }

    function setMarkerLink(marker, symbol, url) {
        if (!allowed() || !marker.isConnected) return;
        marker.textContent = '';
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.className = 'anita-sale-link';
        a.textContent = ' ' + symbol;
        a.title = symbol === '🟩' ? 'Anita Sale: open deze kleur in de uitverkoop' : 'Anita: open het normale assortiment';
        a.setAttribute('aria-label', a.title);
        a.rel = 'noopener noreferrer';
        marker.appendChild(a);
    }

    function replaceWithLoginPill(marker) {
        if (!allowed() || !marker.isConnected) return;
        const parent = marker.parentElement;
        if (!parent) return;

        marker.remove();

        const link = document.createElement('a');
        link.href = 'https://b2b.anita.com/';
        link.target = '_blank';
        link.textContent = 'Inloggen bij b2b';
        link.className = 'anita-login-pill';
        link.rel = 'noopener noreferrer';
        parent.appendChild(link);
    }

    function hasVariantForColor(doc, arnr, fbnr, fullText) {
        if (!doc) return false;

        // 1) Afbeelding met kleurnummer, zoals .../color/186.jpg
        const colorImgs = doc.querySelectorAll('img[src*="/color/"]');
        for (const img of colorImgs) {
            const src = img.getAttribute('src') || '';
            if (fbnr && src.includes(`/${fbnr}.`)) {
                return true;
            }
        }

        // 2) Directe ID-match
        if (arnr && fbnr) {
            const variantId = `article-variant-${arnr}-${fbnr}-accordion-heading`;
            if (doc.getElementById(variantId)) {
                return true;
            }
        }

        // 3) Headers / knoppen met kleurcode
        const headers = doc.querySelectorAll('h2.accordion-header, .accordion-button, [id*="article-variant-"]');
        const wordRegex = fbnr ? new RegExp(`\\b${fbnr}\\b`) : null;
        for (const el of headers) {
            const id = el.id || '';
            const txt = (el.textContent || '').trim();

            if (fbnr && id.includes(`-${fbnr}-`)) {
                return true;
            }
            if (fbnr && (txt.startsWith(fbnr + ' ') || txt === fbnr || (wordRegex && wordRegex.test(txt)))) {
                return true;
            }
        }

        // 4) Laatste redmiddel: volledige tekst
        if (fbnr && wordRegex && wordRegex.test(fullText || '')) {
            return true;
        }

        return false;
    }

    function checkSaleStatus(arnr, fbnr, koll, marker, isSwim) {
        // Badmode eerst in bad-groepen, anders lingerie eerst
        const vaknList = isSwim
            ? ['SVBA50', 'SVBA30', 'SVCO70', 'SVCO50', 'SVCO30']
            : ['SVCO70', 'SVCO50', 'SVCO30', 'SVBA50', 'SVBA30'];

        let index = 0;

        function tryNextVakn() {
            if (!allowed() || !marker.isConnected) return;
            if (index >= vaknList.length) {
                // Geen sale-variant gevonden → zwarte ⬛, klikbaar naar normale productpagina
                const normalUrl = buildNormalUrl(arnr, fbnr, koll);
                setMarkerLink(marker, '⬛', normalUrl);
                return;
            }

            const vakn = vaknList[index++];
            const url = buildSaleUrl(arnr, fbnr, vakn, koll);

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 15000,
                ontimeout: function () { setMarkerPlain(marker, '?'); marker.title = 'Anita-controle mislukt: timeout'; },
                onload: function (response) {
                    if (!allowed() || !marker.isConnected) return;
                    const status = response.status;
                    const text = response.responseText || '';

                    const looksLikeLogin =
                        status === 401 ||
                        status === 403 ||
                        /type=["']password["']/i.test(text || '');

                    if (looksLikeLogin) {
                        replaceWithLoginPill(marker);
                        return;
                    }

                    if (status < 200 || status >= 300) { setMarkerPlain(marker, '?'); marker.title = 'Anita-controle mislukt: HTTP ' + status; return; }
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
                    setMarkerPlain(marker, '?'); marker.title = 'Anita-controle mislukt: netwerkfout';
                }
            });
        }

        tryNextVakn();
    }

    function boot() {
    processRows();
    setInterval(processRows, 1500);

    const observerTarget = document.getElementById('local_data') || document.body;
    const observer = new MutationObserver(() => {
        processRows();
    });

    observer.observe(observerTarget, {
        childList: true,
        subtree: true
    });
    }
    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
