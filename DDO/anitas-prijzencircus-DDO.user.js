// ==UserScript==
// @name         DDO | Anita's Prijzencircus
// @namespace    https://dutchdesignersoutlet.nl/
// @version      0.9
// @description  Check Anita B2B sale status obv Supplier PID en toon een pill achter Advice price in de DDO-backend
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      b2b.anita.com
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/anitas-prijzencircus-DDO.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/anitas-prijzencircus-DDO.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VAKN_LIST = ['SVCO70', 'SVCO50', 'SVCO30', 'SVBA50', 'SVBA30'];

    function log(...args) {
        console.log('[Anita Prijzencircus]', ...args);
    }

    function injectStyles() {
        if (document.getElementById('anita-backend-styles')) return;
        const style = document.createElement('style');
        style.id = 'anita-backend-styles';
        style.textContent = `
            .anita-sale-pill {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                margin-left: 8px;
                padding: 2px 10px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: bold;
                line-height: 1.4;
                color: #fff;
                background: #e67e22; /* oranje default */
                white-space: nowrap;
            }
            .anita-sale-pill--link {
                text-decoration: none !important;
                color: #fff !important;
                cursor: pointer;
            }
            .anita-sale-pill--black {
                background: #000;
            }
            .anita-sale-pill--grey {
                background: #7f8c8d;
            }
        `;
        document.head.appendChild(style);
    }

    function getBrandText() {
        const brandSelect = document.querySelector('select[name="brand_id"]');
        if (!brandSelect) return '';
        const opt = brandSelect.options[brandSelect.selectedIndex];
        return (opt && opt.textContent) ? opt.textContent.trim() : '';
    }

    function isAnitaOrRosaFaia(brandText) {
        return /anita|rosa faia/i.test(brandText || '');
    }

    function getSupplierPid() {
        const inp = document.querySelector('input[name="supplier_pid"]');
        return inp ? inp.value.trim() : '';
    }

    function getAdvicePriceInput() {
        return document.querySelector('input[name="price_advice"]');
    }

    function removeExistingPill(adviceInput) {
        const next = adviceInput && adviceInput.nextElementSibling;
        if (next && next.classList && next.classList.contains('anita-sale-pill')) {
            next.remove();
        }
    }

    function createPill(adviceInput) {
        removeExistingPill(adviceInput);
        const pill = document.createElement('span');
        pill.className = 'anita-sale-pill';
        pill.textContent = '…';
        adviceInput.insertAdjacentElement('afterend', pill);
        return pill;
    }

    function setPillSaleCategory(pill, vakn, url) {
        pill.className = 'anita-sale-pill';
        pill.textContent = '';
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.className = 'anita-sale-pill anita-sale-pill--link';
        a.textContent = vakn;
        pill.replaceWith(a); // link wordt nu de pill
    }

    function setPillLoginRequired(pill) {
        pill.className = 'anita-sale-pill anita-sale-pill--black';
        pill.textContent = '';
        const a = document.createElement('a');
        a.href = 'https://b2b.anita.com/';
        a.target = '_blank';
        a.className = 'anita-sale-pill anita-sale-pill--black anita-sale-pill--link';
        a.textContent = 'Login B2B';
        pill.replaceWith(a);
    }

    function setPillNotFound(pill) {
        pill.className = 'anita-sale-pill anita-sale-pill--grey';
        pill.textContent = 'SPID niet gevonden';
    }

    function parseFromSupplierPid(pidRaw) {
        // Voorbeelden:
        // 4785X-741
        // M5 7811-186
        // M5-7811-186
        let koll = '';
        let arnr = '';
        let fbnr = '';

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

        // fallback: alleen artikelnummer (geen kleur, weinig zin voor sale check)
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
            arnr
        )}&vakn=${encodeURIComponent(vakn)}&sicht=V&fbnr=${encodeURIComponent(fbnr || '')}`;
    }

    function hasVariantForColor(doc, arnr, fbnr, fullText) {
        // zelfde logica als in GG-script

        // 1) Afbeelding met kleurnummer
        const colorImgs = doc.querySelectorAll('img[src*="/color/"]');
        for (const img of colorImgs) {
            const src = img.getAttribute('src') || '';
            if (fbnr && src.includes(`/${fbnr}.`)) {
                return true;
            }
        }

        // 2) Directe ID-match
        const variantId = `article-variant-${arnr}-${fbnr}-accordion-heading`;
        if (fbnr && doc.getElementById(variantId)) {
            return true;
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

        // 4) fallback in volledige tekst
        if (wordRegex && wordRegex.test(fullText)) {
            return true;
        }

        return false;
    }

    function checkSaleStatus(arnr, fbnr, koll, pill) {
        let index = 0;

        function tryNextVakn() {
            if (index >= VAKN_LIST.length) {
                // geen enkele sale categorie met deze kleur
                setPillNotFound(pill);
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
                        log('Login nodig voor Anita B2B');
                        setPillLoginRequired(pill);
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
                        // gevonden in deze sale categorie
                        log('Sale gevonden in', vakn);
                        setPillSaleCategory(pill, vakn, url);
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

    function init() {
        injectStyles();

        const brandText = getBrandText();
        const supplierPid = getSupplierPid();
        const adviceInput = getAdvicePriceInput();

        log('Init', { brandText, supplierPid });

        if (!adviceInput) {
            log('Geen Advice price input gevonden, stoppen.');
            return;
        }

        if (!isAnitaOrRosaFaia(brandText)) {
            log('Merk is geen Anita/Rosa Faia, niks doen.');
            removeExistingPill(adviceInput);
            return;
        }

        if (!supplierPid) {
            log('Geen Supplier PID, SPID niet gevonden.');
            const pill = createPill(adviceInput);
            setPillNotFound(pill);
            return;
        }

        const parsed = parseFromSupplierPid(supplierPid);
        if (!parsed || !parsed.arnr || !parsed.fbnr) {
            log('Supplier PID niet in verwacht formaat, parsed=', parsed);
            const pill = createPill(adviceInput);
            setPillNotFound(pill);
            return;
        }

        const { koll, arnr, fbnr } = parsed;
        log('Parsed SPID', { koll, arnr, fbnr });

        const pill = createPill(adviceInput);
        pill.textContent = '…'; // bezig
        checkSaleStatus(arnr, fbnr, koll, pill);
    }

    // run één keer
    init();

})();
