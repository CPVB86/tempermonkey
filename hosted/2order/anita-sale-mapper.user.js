// ==UserScript==
// @name         2Order | Anita Sale Mapper
// @namespace    https://www.dutchdesignersoutlet.nl/
// @version      1.1
// @description  Vult Anita/Rosa Faia links in Paste2Order aan met juiste VAKN (SVCO/SVBA) + kleurtjes
// @match        https://lingerieoutlet.nl/tools/2order/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      b2b.anita.com
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/hosted/2order/anita-sale-mapper.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/hosted/2order/anita-sale-mapper.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Alleen deze mappen mogen gebruikt worden
    const VAKN_LIST = ['SVCO70', 'SVCO50', 'SVCO30', 'SVBA50', 'SVBA30'];

    // Cache: zelfde SPID niet 10x checken
    // value kan zijn: { vakn, url } of { loginRequired: true } of null
    const CACHE = new Map(); // key: pid

    function log(...args) {
        console.log('[P2O Anita]', ...args);
    }

    // ---------- STYLES ----------

    function injectStyles() {
        if (document.getElementById('p2o-anita-styles')) return;

        const style = document.createElement('style');
        style.id = 'p2o-anita-styles';
        style.textContent = `
            .p2o-anita-mapped {
                background-color: #d4f8d4 !important; /* lichtgroen */
                border-radius: 3px;
            }
            .p2o-anita-unmapped {
                background-color: #e5e5e5 !important; /* lichtgrijs */
                border-radius: 3px;
            }
            .p2o-anita-login {
                background-color: #f8d4d4 !important; /* lichtrood */
                border-radius: 3px;
            }
        `;
        document.head.appendChild(style);
    }

    // ---------- HULPFUNCTIES ----------

    function isAnitaRow(tr) {
        // Pak de titelcel (3e kolom in jouw hoofd-tabel)
        const titleTd = tr.querySelector('td:nth-child(3)');
        const txt = (titleTd ? titleTd.textContent : '').toLowerCase();
        return txt.includes('anita') || txt.includes('rosa faia');
    }

    // SPID parser (zoals in jouw scripts)
    function parseFromSupplierPid(pidRaw) {
        // Voorbeelden:
        //  4785X-741
        //  M5 7811-186
        //  M5-7811-186
        let koll = '';
        let arnr = '';
        let fbnr = '';

        pidRaw = (pidRaw || '').trim();

        let m = pidRaw.match(/^([A-Za-z0-9]{2})\s*[- ]?(\d{4}[A-Za-z]?)\-(\d{3})$/);
        if (m) {
            koll = m[1].toUpperCase();
            arnr = m[2];
            fbnr = m[3];
            return { koll, arnr, fbnr };
        }

        m = pidRaw.match(/^(\d{4}[A-Za-z]?)\-(\d{3})$/);
        if (m) {
            arnr = m[1];
            fbnr = m[2];
            return { koll: '', arnr, fbnr };
        }

        m = pidRaw.match(/^(\d{4}[A-Za-z]?)$/);
        if (m) {
            arnr = m[1];
            return { koll: '', arnr, fbnr: '' };
        }

        return null;
    }

    function buildSaleUrl(arnr, fbnr, vakn, koll) {
        return `https://b2b.anita.com/nl/shop/441/?fssc=N&vsas=&koll=${encodeURIComponent(
            koll || ''
        )}&form=&vacp=&arnr=${encodeURIComponent(
            arnr || ''
        )}&vakn=${encodeURIComponent(vakn || '')}&sicht=V&fbnr=${encodeURIComponent(fbnr || '')}`;
    }

    function hasVariantForColor(doc, arnr, fbnr, fullText) {
        if (!fbnr) return false;

        // 1) Afbeelding met kleurnummer
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
        const headers = doc.querySelectorAll(
            'h2.accordion-header, .accordion-button, [id*="article-variant-"]'
        );
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

        // 4) fallback in volledige tekst
        if (wordRegex.test(fullText)) {
            return true;
        }

        return false;
    }

    // ---------- SALE CHECK VIA B2B ----------

    function checkSaleStatus(pid, parsed, cb) {
        if (CACHE.has(pid)) {
            cb(CACHE.get(pid)); // kan null of {loginRequired:true} of mapping zijn
            return;
        }

        const { koll, arnr, fbnr } = parsed;
        let index = 0;

        function tryNextVakn() {
            if (index >= VAKN_LIST.length) {
                // Nergens gevonden → géén vakn
                CACHE.set(pid, null);
                cb(null);
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
                        log('Login nodig / login-scherm voor', pid, 'vakn', vakn);
                        const result = { loginRequired: true };
                        CACHE.set(pid, result);
                        cb(result);
                        return;
                    }

                    if (status < 200 || status >= 300 || !text) {
                        tryNextVakn();
                        return;
                    }

                    let hasVariant = false;
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(text, 'text/html');
                        hasVariant = hasVariantForColor(doc, arnr, fbnr, text);
                    } catch (e) {
                        log('Parse error:', e);
                    }

                    if (hasVariant) {
                        log('Sale gevonden voor', pid, 'in', vakn);
                        const result = { vakn, url };
                        CACHE.set(pid, result);
                        cb(result);
                    } else {
                        tryNextVakn();
                    }
                },
                onerror: function (e) {
                    log('Request error', e);
                    tryNextVakn();
                }
            });
        }

        tryNextVakn();
    }

    // ---------- LINK PATCH ----------

    function enhanceAnitaLink(a) {
        if (!a || a.dataset.anitaEnhanced === '1') return;
        if (!a.href || a.href.indexOf('b2b.anita.com') === -1) return;

        const tr = a.closest('tr');
        if (!tr) return;

        if (!isAnitaRow(tr)) {
            a.dataset.anitaEnhanced = '1';
            return;
        }

        const pid = (a.textContent || '').trim();
        if (!pid) {
            a.dataset.anitaEnhanced = '1';
            return;
        }

        const parsed = parseFromSupplierPid(pid);
        if (!parsed || !parsed.arnr) {
            a.dataset.anitaEnhanced = '1';
            log('PID niet bruikbaar voor Anita mapping:', pid, parsed);
            return;
        }

        // Originele href bewaren (voor login-fout scenario)
        if (!a.dataset.anitaOriginalHref) {
            a.dataset.anitaOriginalHref = a.href;
        }

        a.dataset.anitaEnhanced = '1';
        a.title = (a.title || '') + ' [check Anita sale…]';

        checkSaleStatus(pid, parsed, function (res) {
            // Altijd een nette artikel-URL opbouwen, maar mogelijk zonder vakn
            const urlNoVakn = buildSaleUrl(
                parsed.arnr,
                parsed.fbnr || '',
                '',                // vakn leeg bij geen mapping
                parsed.koll || ''
            );

            // Reset kleurclasses
            a.classList.remove('p2o-anita-mapped', 'p2o-anita-unmapped', 'p2o-anita-login');

            // 1) LOGIN PROBLEEM → rood
            if (res && res.loginRequired) {
                const href = a.dataset.anitaOriginalHref || urlNoVakn;
                a.href = href;
                a.title = 'Login vereist op Anita B2B';
                a.classList.add('p2o-anita-login');
                log('Login vereist voor', pid, 'href=', href);
                return;
            }

            // 2) GEEN mapping gevonden → grijs, vakn leeg
            if (!res || !res.vakn || !res.url) {
                a.href = urlNoVakn;
                a.title = 'Open Anita B2B';
                a.classList.add('p2o-anita-unmapped'); // lichtgrijs
                log('Geen sale-mapping, gebruik URL zonder vakn:', pid, urlNoVakn);
                return;
            }

            // 3) WÉL mapping gevonden → groen, URL met vakn
            a.href = res.url;
            a.title = 'Open Anita B2B – ' + res.vakn;
            a.classList.add('p2o-anita-mapped'); // lichtgroen
            log('Sale-mapping voor', pid, '→', res.vakn, res.url);

            // Optioneel: VAKN-tekst achter de SPID tonen
            if (!a.nextSibling) {
                const span = document.createElement('span');
                span.textContent = ' [' + res.vakn + ']';
                span.style.fontSize = '0.8em';
                span.style.color = '#555';
                a.parentElement.appendChild(span);
            }
        });
    }

    // ---------- SCAN & OBSERVER ----------

    function scanAllRows() {
        // Supplier-links in hoofdtabel
        const links = document.querySelectorAll('#orderTable tbody a.supplier-link');
        links.forEach(enhanceAnitaLink);

        // Ook in split-cards
        const splitLinks = document.querySelectorAll('#splitContainer a.supplier-link');
        splitLinks.forEach(enhanceAnitaLink);
    }

    function initObserver() {
        const target = document.body;
        if (!target) return;

        const obs = new MutationObserver(() => {
            scanAllRows();
        });

        obs.observe(target, { childList: true, subtree: true });
    }

    // ---------- INIT ----------

    function init() {
        injectStyles();
        log('Init Paste2Order Anita Sale Mapper');
        scanAllRows();
        initObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
