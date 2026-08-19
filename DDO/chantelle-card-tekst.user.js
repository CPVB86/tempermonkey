// ==UserScript==
// @name         DDO | Chantelle producttekst
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      2.2.0
// @description  Haalt exacte Chantelle-productteksten op, optioneel meertalig, inclusief opgeschoonde onderhoud- en samenstellingsinformatie.
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/chantelle-card-tekst.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/chantelle-card-tekst.user.js
// @match        https://www.dutchdesignersoutlet.com/*
// @match        https://dutchdesignersoutlet.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      chantelle.com
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // INSTELLINGEN
    // ============================================================

    /*
     * true  = NL + EN + DE + FR
     * false = alleen NL
     */
    const MULTILANGUAGE = false;

    const CHANTELLE_BASE = 'https://chantelle.com';

    const BUTTON_ID = 'ddo-chantelle-producttekst';
    const STATUS_ID = 'ddo-chantelle-producttekst-status';

    const LANGUAGES = {
        nl: {
            label: 'NL',
            header: 'Onderhoud en samenstelling',
            resolverPaths: [
                '/nl-be/api/algolia/pdp/'
            ],
            hreflang: [
                'nl-NL',
                'nl-BE',
                'nl'
            ]
        },

        en: {
            label: 'EN',
            header: 'Material and care',
            resolverPaths: [
                '/shop/en-nl/api/algolia/pdp/',
                '/shop/en-ie/api/algolia/pdp/'
            ],
            hreflang: [
                'en-NL',
                'en-IE',
                'en-GB',
                'en-US',
                'en'
            ]
        },

        de: {
            label: 'DE',
            header: 'Pflege und Material',
            resolverPaths: [
                '/de/api/algolia/pdp/'
            ],
            hreflang: [
                'de-DE',
                'de-AT',
                'de'
            ]
        },

        fr: {
            label: 'FR',
            header: 'Entretien et composition',
            resolverPaths: [
                '/fr/api/algolia/pdp/',
                '/fr-be/api/algolia/pdp/'
            ],
            hreflang: [
                'fr-FR',
                'fr-BE',
                'fr'
            ]
        }
    };


    // ============================================================
    // HELPERS
    // ============================================================

    function clean(value) {
        return String(value || '')
            .replace(/\p{Cf}/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeSku(value) {
        return clean(value).toUpperCase();
    }

    function selectedBrand() {
        const select = document.querySelector(
            'select#brand[name="brand_id"]'
        );

        return clean(
            select?.selectedOptions?.[0]?.textContent
        );
    }

    function allowedBrand() {
        return /^chantelle\b/i.test(
            selectedBrand()
        );
    }

    function supplierPid() {
        return clean(
            document.querySelector(
                'input[name="supplier_pid"]'
            )?.value
        );
    }


    // ============================================================
    // HTTP
    // ============================================================

    function request(url, responseType = 'text') {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,

                headers: {
                    Accept:
                        responseType === 'json'
                            ? 'application/json'
                            : 'text/html,application/xhtml+xml,*/*;q=0.8',

                    'Accept-Language':
                        'nl-NL,nl;q=0.9,en;q=0.8,de;q=0.7,fr;q=0.6'
                },

                timeout: 25000,

                onload(response) {
                    if (
                        response.status < 200 ||
                        response.status >= 300
                    ) {
                        const error =
                            new Error(
                                `HTTP ${response.status}`
                            );

                        error.status =
                            response.status;

                        error.url =
                            url;

                        reject(error);
                        return;
                    }

                    if (
                        responseType === 'json'
                    ) {
                        try {
                            resolve(
                                JSON.parse(
                                    response.responseText
                                )
                            );
                        } catch {
                            reject(
                                new Error(
                                    'Ongeldige JSON-response'
                                )
                            );
                        }

                        return;
                    }

                    resolve(
                        response.responseText
                    );
                },

                onerror() {
                    reject(
                        new Error(
                            'Netwerkfout'
                        )
                    );
                },

                ontimeout() {
                    reject(
                        new Error(
                            'Timeout'
                        )
                    );
                }
            });
        });
    }


    function parseHtml(html) {
        return new DOMParser()
            .parseFromString(
                html,
                'text/html'
            );
    }


    // ============================================================
    // EXACTE PRODUCT URL
    // ============================================================

    function findExactProductUrl(
        data,
        expectedSku,
        resolverPath
    ) {
        const wanted =
            normalizeSku(expectedSku);

        const seen =
            new WeakSet();

        const localeBase =
            resolverPath.replace(
                /\/api\/algolia\/pdp\/?$/i,
                ''
            );

        function containsExactSku(value) {
            return (
                typeof value === 'string' &&
                value
                    .toUpperCase()
                    .includes(wanted)
            );
        }


        function buildUrl(value) {
            if (
                typeof value !== 'string' ||
                !value.trim() ||
                !containsExactSku(value)
            ) {
                return null;
            }

            let link =
                value.trim();

            if (
                /^https?:\/\//i.test(link)
            ) {
                return link;
            }

            if (
                !link.startsWith('/')
            ) {
                link =
                    '/' + link;
            }

            /*
             * Locale zit al in de URL.
             */
            if (
                /\/(?:produit|produkt|product)\//i.test(
                    link
                ) &&
                (
                    link.startsWith('/nl-be/') ||
                    link.startsWith('/fr/') ||
                    link.startsWith('/fr-be/') ||
                    link.startsWith('/de/') ||
                    link.startsWith('/shop/')
                )
            ) {
                return (
                    CHANTELLE_BASE +
                    link
                );
            }

            /*
             * /produit/...
             * /produkt/...
             * /product/...
             */
            if (
                /^\/(?:produit|produkt|product)\//i.test(
                    link
                )
            ) {
                return (
                    CHANTELLE_BASE +
                    localeBase +
                    link
                );
            }

            /*
             * urlKey.
             */
            let route =
                'produit';

            if (
                localeBase.startsWith(
                    '/de'
                )
            ) {
                route =
                    'produkt';

            } else if (
                localeBase.startsWith(
                    '/shop/en'
                )
            ) {
                route =
                    'product';
            }

            link = link
                .replace(/^\/+/, '')
                .replace(
                    /^(?:produit|produkt|product)\//i,
                    ''
                );

            return (
                CHANTELLE_BASE +
                localeBase +
                '/' +
                route +
                '/' +
                link
            );
        }


        function walk(value) {
            if (
                typeof value === 'string'
            ) {
                if (
                    containsExactSku(value)
                ) {
                    const url =
                        buildUrl(value);

                    if (url) {
                        return url;
                    }
                }

                return null;
            }

            if (
                !value ||
                typeof value !== 'object'
            ) {
                return null;
            }

            if (
                seen.has(value)
            ) {
                return null;
            }

            seen.add(value);

            const candidates = [
                value.productLink,
                value.product_link,
                value.urlKey,
                value.url_key,
                value.url,
                value.path,
                value.link
            ];

            for (
                const candidate of
                candidates
            ) {
                if (
                    typeof candidate !==
                    'string'
                ) {
                    continue;
                }

                if (
                    !containsExactSku(
                        candidate
                    )
                ) {
                    continue;
                }

                const url =
                    buildUrl(
                        candidate
                    );

                if (url) {
                    console.log(
                        '[DDO Chantelle] Exacte URL:',
                        url
                    );

                    return url;
                }
            }

            for (
                const child of
                Object.values(value)
            ) {
                const found =
                    walk(child);

                if (found) {
                    return found;
                }
            }

            return null;
        }

        return walk(data);
    }


    async function resolveViaAlgolia(
        lang,
        sku
    ) {
        const config =
            LANGUAGES[lang];

        let lastError = null;

        for (
            const resolverPath of
            config.resolverPaths
        ) {
            const url =
                CHANTELLE_BASE +
                resolverPath +
                encodeURIComponent(sku);

            try {
                const data =
                    await request(
                        url,
                        'json'
                    );

                const productUrl =
                    findExactProductUrl(
                        data,
                        sku,
                        resolverPath
                    );

                if (productUrl) {
                    return productUrl;
                }

                lastError =
                    new Error(
                        'Exact product niet gevonden'
                    );

            } catch (error) {
                lastError =
                    error;
            }
        }

        throw (
            lastError ||
            new Error(
                'Niet beschikbaar'
            )
        );
    }


    // ============================================================
    // HREFLANG
    // ============================================================

    function findAlternateUrl(
        doc,
        lang
    ) {
        const config =
            LANGUAGES[lang];

        const links = [
            ...doc.querySelectorAll(
                'link[rel="alternate"][hreflang][href]'
            )
        ];

        for (
            const wanted of
            config.hreflang
        ) {
            const match =
                links.find(
                    link =>
                        clean(
                            link.getAttribute(
                                'hreflang'
                            )
                        ).toLowerCase() ===
                        wanted.toLowerCase()
                );

            if (match) {
                return match.href;
            }
        }

        return null;
    }


    // ============================================================
    // EXACTE SKU-CHECK OP PDP
    // ============================================================

    function pageContainsExactSku(
        doc,
        html,
        sku
    ) {
        const wanted =
            normalizeSku(sku);

        const canonical =
            doc
                .querySelector(
                    'link[rel="canonical"]'
                )
                ?.getAttribute(
                    'href'
                ) || '';

        if (
            canonical
                .toUpperCase()
                .includes(wanted)
        ) {
            return true;
        }

        const variants = [
            `"sku":"${wanted}"`,
            `"sku": "${wanted}"`,
            `\\"sku\\":\\"${wanted}\\"`,
            `\\"sku\\": \\"${wanted}\\"`
        ];

        return variants.some(
            value =>
                html.includes(value)
        );
    }


    // ============================================================
    // CONTENT OPSCHONEN
    // ============================================================

    function stripAttributes(root) {
        const elements = [
            root,
            ...root.querySelectorAll('*')
        ];

        for (
            const element of elements
        ) {
            for (
                const attr of [
                    ...(element.attributes || [])
                ]
            ) {
                if (
                    attr.name.startsWith(
                        'data-gp-'
                    ) ||
                    attr.name ===
                        'data-testid'
                ) {
                    element.removeAttribute(
                        attr.name
                    );
                }
            }
        }

        const walker =
            document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT
            );

        let node;

        while (
            (node =
                walker.nextNode())
        ) {
            node.nodeValue =
                String(
                    node.nodeValue || ''
                ).replace(
                    /\p{Cf}/gu,
                    ''
                );
        }

        root
            .querySelectorAll(
                'ul > br, ol > br'
            )
            .forEach(
                el => el.remove()
            );
    }


    function cleanedInnerHtml(
        source
    ) {
        const clone =
            source.cloneNode(true);

        stripAttributes(
            clone
        );

        return clone.innerHTML
            .replace(
                />\s+</g,
                '><'
            )
            .trim();
    }


    // ============================================================
    // MATERIAALREGELS NORMALISEREN
    // ============================================================

    function normalizeCompositionLine(
        value,
        lang
    ) {
        let text =
            clean(value);

        if (!text) {
            return '';
        }

        /*
         * Alleen regels met percentages/materialen
         * stevig normaliseren.
         */
        if (
            !/\d+(?:[.,]\d+)?\s*%/.test(
                text
            )
        ) {
            return text;
        }

        /*
         * Alles lowercase.
         *
         * TULLE 82% POLYAMIDE
         * ->
         * tulle 82% polyamide
         */
        text =
            text.toLocaleLowerCase();

        /*
         * Veel voorkomende slechte/verschillende
         * spelling in NL-resultaten.
         */
        if (
            lang === 'nl'
        ) {
            text = text
                .replace(
                    /\belasthanne\b/g,
                    'elastaan'
                )
                .replace(
                    /\belasthaan\b/g,
                    'elastaan'
                )
                .replace(
                    /\belastane\b/g,
                    'elastaan'
                )
                .replace(
                    /\bpolyester\b/g,
                    'polyester'
                )
                .replace(
                    /\bpolyamide\b/g,
                    'polyamide'
                );
        }

        /*
         * Eerste letter hoofdletter,
         * tenzij de regel met een cijfer begint.
         */
        if (
            /^[a-zà-ÿ]/i.test(text)
        ) {
            text =
                text.charAt(0)
                    .toLocaleUpperCase() +
                text.slice(1);
        }

        return text;
    }


    // ============================================================
    // ONDERHOUD + SAMENSTELLING OPSCHONEN
    // ============================================================

    function htmlToLines(source) {
        const clone =
            source.cloneNode(true);

        stripAttributes(
            clone
        );

        clone
            .querySelectorAll(
                'br'
            )
            .forEach(br => {
                br.replaceWith(
                    '\n'
                );
            });

        clone
            .querySelectorAll(
                'p, div, li, u, strong'
            )
            .forEach(el => {
                el.insertAdjacentText(
                    'afterend',
                    '\n'
                );
            });

        return String(
            clone.textContent || ''
        )
            .split(/\n+/)
            .map(clean)
            .filter(Boolean);
    }


    function isSupplierInfoStart(
        line
    ) {
        return (
            /manufacturer/i.test(line) ||
            /hersteller/i.test(line) ||
            /fabricant/i.test(line) ||
            /fabrikant/i.test(line) ||

            /supplier/i.test(line) ||
            /lieferant/i.test(line) ||
            /fournisseur/i.test(line) ||

            /warehouse/i.test(line) ||
            /lageradresse/i.test(line) ||

            /contact details/i.test(line) ||
            /kontaktdaten/i.test(line) ||
            /coordonnées/i.test(line)
        );
    }


    function isObviouslyContactLine(
        line
    ) {
        return (
            /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
                .test(line) ||

            /https?:\/\//i.test(line) ||

            /\bwww\./i.test(line)
        );
    }


    function cleanCareHtml(
    source,
    lang
) {
    const lines =
        htmlToLines(source);

    const kept = [];

    for (
        const originalLine of lines
    ) {
        if (
            isSupplierInfoStart(
                originalLine
            )
        ) {
            break;
        }

        if (
            isObviouslyContactLine(
                originalLine
            )
        ) {
            continue;
        }

        const line =
            normalizeCompositionLine(
                originalLine,
                lang
            );

        if (
            line &&
            !kept.includes(line)
        ) {
            kept.push(line);
        }
    }

    if (!kept.length) {
        return '';
    }

    /*
     * Kopjes herkennen en dubbele losse ":" opruimen.
     */
    const normalized = [];

    for (
        let i = 0;
        i < kept.length;
        i++
    ) {
        let line =
            kept[i];

        /*
         * "Onderhoudstips" + losse ":" samenvoegen.
         */
        if (
            /^(onderhoudstips|care tips|pflegehinweise|conseils d'entretien)$/i
                .test(line) &&
            kept[i + 1] === ':'
        ) {
            line += ':';
            i++;
        }

        /*
         * "Samenstelling" + losse ":" samenvoegen.
         */
        if (
            /^(samenstelling|composition|material|materials|zusammensetzung)$/i
                .test(line) &&
            kept[i + 1] === ':'
        ) {
            line += ':';
            i++;
        }

        /*
         * Losse dubbele punt nooit tonen.
         */
        if (
            line === ':'
        ) {
            continue;
        }

        normalized.push(
            line
        );
    }


    // ============================================================
    // HTML MET LOGISCHE BLOKKEN
    // ============================================================

    const output = [];

    let inComposition =
        false;

    for (
        const line of normalized
    ) {
        /*
         * Onderhoudskop.
         */
        if (
            /^(onderhoudstips|care tips|pflegehinweise|conseils d'entretien):?$/i
                .test(line)
        ) {
            output.push(
                `<p>${escapeHtml(
                    line.replace(/:$/, '')
                )}:</p>`
            );

            continue;
        }

        /*
         * Samenstellingskop.
         */
        if (
            /^(samenstelling|composition|material|materials|zusammensetzung):?$/i
                .test(line)
        ) {
            inComposition =
                true;

            output.push(
                `<p>${escapeHtml(
                    line.replace(/:$/, '')
                )}:</p>`
            );

            continue;
        }

        /*
         * Materiaalregels graag compact onder elkaar.
         */
        if (
            inComposition
        ) {
            output.push(
                escapeHtml(line)
            );

            continue;
        }

        /*
         * Normale onderhoudstekst.
         */
        output.push(
            escapeHtml(line)
        );
    }


    /*
     * Van materiaalregels één blok maken met <br>.
     */
    let html =
        output.join('<br>');

    /*
     * Voor kopjes juist een witregel maken.
     */
    html = html
        .replace(
            /<br><p>/g,
            '<br><br><p>'
        )
        .replace(
            /<\/p><br>/g,
            '</p>'
        );

    return (
        '<p>' +
        html +
        '</p>'
    );
}


    function escapeHtml(value) {
        const div =
            document.createElement(
                'div'
            );

        div.textContent =
            String(value || '');

        return div.innerHTML;
    }


    // ============================================================
    // ACCORDIONS
    // ============================================================

    function accordionItems(doc) {
        const container =
            doc.querySelector(
                '.pdp__product-additional-info'
            );

        if (!container) {
            return [];
        }

        return [
            ...container.querySelectorAll(
                'details'
            )
        ].map(detail => {
            const title =
                clean(
                    detail.querySelector(
                        'summary'
                    )?.textContent
                );

            const content =
                detail.querySelector(
                    '.accordion-item__content'
                );

            return {
                title,

                content:
                    content?.querySelector(
                        ':scope > div'
                    ) ||
                    content ||
                    null
            };
        });
    }


    function isDescriptionTitle(
        value
    ) {
        return /^(beschrijving|description|beschreibung)$/i
            .test(
                clean(value)
            );
    }


    function isCareTitle(
        value
    ) {
        const text =
            clean(value);

        return (
            /onderhoud.*samenstelling/i
                .test(text) ||

            /material.*care/i
                .test(text) ||

            /care.*material/i
                .test(text) ||

            /pflege.*material/i
                .test(text) ||

            /entretien.*composition/i
                .test(text)
        );
    }


    function getProductContent(
        doc,
        lang
    ) {
        const items =
            accordionItems(doc);

        const description =
            items.find(
                item =>
                    isDescriptionTitle(
                        item.title
                    )
            );

        if (
            !description?.content
        ) {
            throw new Error(
                'Beschrijving niet gevonden'
            );
        }

        const descriptionHtml =
            cleanedInnerHtml(
                description.content
            );

        const care =
            items.find(
                item =>
                    isCareTitle(
                        item.title
                    )
            );

        let html =
            descriptionHtml;

        let hasCare =
            false;

        if (
            care?.content
        ) {
            const careHtml =
                cleanCareHtml(
                    care.content,
                    lang
                );

            if (careHtml) {
                hasCare =
                    true;

                html +=
                    '\n<p><strong>' +
                    LANGUAGES[lang].header +
                    '</strong></p>\n' +
                    careHtml;
            }
        }

        return {
            html,
            hasCare
        };
    }


    // ============================================================
    // META
    // ============================================================

    function getMetaDescription(
        doc
    ) {
        return clean(
            doc
                .querySelector(
                    'meta[name="description"]'
                )
                ?.getAttribute(
                    'content'
                )
        );
    }


    function setMetaDescription(
        lang,
        value
    ) {
        if (!value) {
            return false;
        }

        const textarea =
            document.querySelector(
                `textarea[name="meta[${lang}][description]"]`
            );

        if (!textarea) {
            return false;
        }

        textarea.value =
            clean(value);

        textarea.dispatchEvent(
            new Event(
                'input',
                {
                    bubbles: true
                }
            )
        );

        textarea.dispatchEvent(
            new Event(
                'change',
                {
                    bubbles: true
                }
            )
        );

        return true;
    }


    // ============================================================
    // TINYMCE
    // ============================================================

    function getLanguageTextarea(
        lang
    ) {
        const textarea =
            document.querySelector(
                `textarea[name="lang[${lang}][description]"]`
            );

        if (textarea) {
            return textarea;
        }

        /*
         * NL fallback.
         */
        if (
            lang === 'nl'
        ) {
            return (
                document.querySelector(
                    '#mce_1'
                ) ||
                null
            );
        }

        return null;
    }


    function setEditorContent(
        lang,
        html
    ) {
        const textarea =
            getLanguageTextarea(
                lang
            );

        if (!textarea) {
            throw new Error(
                `DDO ${lang.toUpperCase()}-veld niet gevonden`
            );
        }

        const editorId =
            textarea.id;

        const page =
            typeof unsafeWindow !==
            'undefined'
                ? unsafeWindow
                : window;

        const tiny =
            page.tinyMCE ||
            page.tinymce;

        const editor =
            tiny?.get?.(
                editorId
            ) ||
            tiny?.getInstanceById?.(
                editorId
            );

        if (
            editor?.setContent
        ) {
            editor.setContent(
                html
            );

            editor.save?.();

            editor.fire?.(
                'change'
            );

            textarea.value =
                html;

            return true;
        }

        const iframe =
            document.querySelector(
                `#${CSS.escape(editorId)}_ifr`
            );

        if (
            iframe
                ?.contentDocument
                ?.body
        ) {
            iframe
                .contentDocument
                .body
                .innerHTML =
                html;

            textarea.value =
                html;

            return true;
        }

        throw new Error(
            `TinyMCE ${editorId} niet gevonden`
        );
    }


    // ============================================================
    // STATUS
    // ============================================================

    function enabledLanguages() {
        return MULTILANGUAGE
            ? [
                'nl',
                'en',
                'de',
                'fr'
            ]
            : [
                'nl'
            ];
    }


    function createStatusBox(
        button
    ) {
        let box =
            document.getElementById(
                STATUS_ID
            );

        if (box) {
            return box;
        }

        box =
            document.createElement(
                'div'
            );

        box.id =
            STATUS_ID;

        box.style.cssText = `
            display:none;
            margin:0 0 12px 0;
            padding:9px 11px;
            width:480px;
            max-width:100%;
            box-sizing:border-box;
            border:1px solid #ccc;
            border-radius:4px;
            background:#f7f7f7;
            font-size:12px;
            line-height:1.7;
        `;

        for (
            const lang of
            enabledLanguages()
        ) {
            const row =
                document.createElement(
                    'div'
                );

            row.id =
                `${STATUS_ID}-${lang}`;

            row.innerHTML =
                `<strong>${LANGUAGES[lang].label}</strong> <span>—</span>`;

            box.appendChild(
                row
            );
        }

        button.insertAdjacentElement(
            'afterend',
            box
        );

        return box;
    }


    function setLanguageStatus(
        lang,
        type,
        message
    ) {
        const row =
            document.getElementById(
                `${STATUS_ID}-${lang}`
            );

        if (!row) {
            return;
        }

        const span =
            row.querySelector(
                'span'
            );

        const icons = {
            loading: '…',
            success: '✓',
            warning: '!',
            unavailable: '—',
            error: '✕'
        };

        const colors = {
            loading: '#2764e2',
            success: '#147a38',
            warning: '#a26000',
            unavailable: '#666',
            error: '#b3000c'
        };

        span.textContent =
            `${icons[type] || ''} ${message}`;

        span.style.color =
            colors[type] ||
            '#333';

        span.style.fontWeight =
            type === 'success' ||
            type === 'error'
                ? 'bold'
                : 'normal';
    }


    function setButtonState(
        button,
        state,
        text
    ) {
        button.textContent =
            text;

        button.style.background =
            '';

        button.style.borderColor =
            '';

        button.style.color =
            '';

        if (
            state === 'success'
        ) {
            button.style.background =
                '#dff3e5';

            button.style.borderColor =
                '#65a978';

            button.style.color =
                '#165c2c';
        }

        if (
            state === 'partial'
        ) {
            button.style.background =
                '#fff2cd';

            button.style.borderColor =
                '#d4a72c';

            button.style.color =
                '#725300';
        }

        if (
            state === 'error'
        ) {
            button.style.background =
                '#fbe2e4';

            button.style.borderColor =
                '#c64b55';

            button.style.color =
                '#8c111b';
        }
    }


    // ============================================================
    // PRODUCT TAAL OPHALEN
    // ============================================================

    async function processLanguage(
        lang,
        sku,
        url
    ) {
        const html =
            await request(
                url,
                'text'
            );

        const doc =
            parseHtml(html);

        if (
            !pageContainsExactSku(
                doc,
                html,
                sku
            )
        ) {
            throw new Error(
                'Niet exact dezelfde SKU'
            );
        }

        const content =
            getProductContent(
                doc,
                lang
            );

        /*
         * Pas NU schrijven.
         *
         * Dus pas nadat exacte SKU en
         * geldige content bewezen zijn.
         */
        setEditorContent(
            lang,
            content.html
        );

        const meta =
            getMetaDescription(
                doc
            );

        if (meta) {
            setMetaDescription(
                lang,
                meta
            );
        }

        return {
            doc,
            url,
            hasCare:
                content.hasCare
        };
    }


    // ============================================================
    // ALTERNATE + ALGOLIA KANDIDATEN
    // ============================================================

    async function findWorkingLanguagePage(
        lang,
        sku,
        baseDoc
    ) {
        const candidates = [];

        /*
         * 1. Officiële hreflang van Chantelle.
         */
        const alternate =
            findAlternateUrl(
                baseDoc,
                lang
            );

        if (alternate) {
            candidates.push(
                alternate
            );
        }

        /*
         * 2. Exacte taal-SKU via Algolia.
         */
        try {
            const resolved =
                await resolveViaAlgolia(
                    lang,
                    sku
                );

            if (
                resolved &&
                !candidates.includes(
                    resolved
                )
            ) {
                candidates.push(
                    resolved
                );
            }

        } catch {
            // Geen probleem:
            // taal kan simpelweg ontbreken.
        }


        for (
            const url of candidates
        ) {
            try {
                const result =
                    await processLanguage(
                        lang,
                        sku,
                        url
                    );

                return result;

            } catch (error) {
                console.warn(
                    `[DDO Chantelle] ${lang.toUpperCase()} kandidaat niet bruikbaar:`,
                    url,
                    error
                );
            }
        }

        return null;
    }


    // ============================================================
    // GENERATE
    // ============================================================

    async function generate(
        button
    ) {
        const sku =
            normalizeSku(
                supplierPid()
            );

        if (!sku) {
            alert(
                'Vul eerst een Supplier PID in.'
            );

            return;
        }

        button.disabled =
            true;

        const status =
            createStatusBox(
                button
            );

        status.style.display =
            'block';

        setButtonState(
            button,
            'loading',
            'Chantelle-product zoeken…'
        );


        // ========================================================
        // NL IS ALTIJD VERPLICHT
        // ========================================================

        let nlUrl;

        try {
            setLanguageStatus(
                'nl',
                'loading',
                sku + ' zoeken'
            );

            nlUrl =
                await resolveViaAlgolia(
                    'nl',
                    sku
                );

        } catch (error) {
            setLanguageStatus(
                'nl',
                'unavailable',
                'Niet beschikbaar'
            );

            setButtonState(
                button,
                'error',
                `Product ${sku} niet beschikbaar ✕`
            );

            button.disabled =
                false;

            return;
        }


        let nlResult;

        try {
            nlResult =
                await processLanguage(
                    'nl',
                    sku,
                    nlUrl
                );

            setLanguageStatus(
                'nl',
                nlResult.hasCare
                    ? 'success'
                    : 'warning',
                nlResult.hasCare
                    ? 'beschrijving + onderhoud ingevuld'
                    : 'beschrijving ingevuld'
            );

        } catch (error) {
            console.error(
                '[DDO Chantelle] NL mislukt:',
                error
            );

            setLanguageStatus(
                'nl',
                'error',
                error.message
            );

            setButtonState(
                button,
                'error',
                'Nederlandse producttekst niet ingevuld ✕'
            );

            button.disabled =
                false;

            return;
        }


        // ========================================================
        // ALLEEN NL?
        // ========================================================

        if (
            !MULTILANGUAGE
        ) {
            setButtonState(
                button,
                'success',
                'Nederlandse producttekst ingevuld ✓'
            );

            button.disabled =
                false;

            return;
        }


        // ========================================================
        // EN / DE / FR
        // ========================================================

        let successCount =
            1;

        for (
            const lang of [
                'en',
                'de',
                'fr'
            ]
        ) {
            setLanguageStatus(
                lang,
                'loading',
                'zoeken'
            );

            try {
                const result =
                    await findWorkingLanguagePage(
                        lang,
                        sku,
                        nlResult.doc
                    );

                if (!result) {
                    /*
                     * Heel belangrijk:
                     *
                     * GEEN ander product,
                     * GEEN andere kleur,
                     * GEEN andere SKU.
                     *
                     * En het bestaande DDO-veld
                     * blijft ongemoeid.
                     */
                    setLanguageStatus(
                        lang,
                        'unavailable',
                        'Niet beschikbaar'
                    );

                    continue;
                }

                successCount++;

                setLanguageStatus(
                    lang,
                    result.hasCare
                        ? 'success'
                        : 'warning',
                    result.hasCare
                        ? 'beschrijving + onderhoud ingevuld'
                        : 'beschrijving ingevuld'
                );

            } catch (error) {
                console.error(
                    `[DDO Chantelle] ${lang.toUpperCase()} mislukt:`,
                    error
                );

                setLanguageStatus(
                    lang,
                    'unavailable',
                    'Niet beschikbaar'
                );
            }
        }


        // ========================================================
        // EINDSTATUS
        // ========================================================

        if (
            successCount === 4
        ) {
            setButtonState(
                button,
                'success',
                'NL + EN + DE + FR ingevuld ✓'
            );

        } else {
            setButtonState(
                button,
                'partial',
                `${successCount}/4 talen beschikbaar`
            );
        }

        button.disabled =
            false;
    }


    // ============================================================
    // BUTTON
    // ============================================================

    function installButton() {
        if (
            document.getElementById(
                BUTTON_ID
            )
        ) {
            return;
        }

        const pidInput =
            document.querySelector(
                'input[name="supplier_pid"]'
            );

        const nlTextarea =
            getLanguageTextarea(
                'nl'
            );

        let editorTable =
            null;

        if (
            nlTextarea?.id
        ) {
            editorTable =
                document.getElementById(
                    nlTextarea.id +
                    '_tbl'
                );
        }

        editorTable =
            editorTable ||
            document.querySelector(
                '#mce_1_tbl'
            );

        if (
            !pidInput ||
            !editorTable
        ) {
            return;
        }

        const button =
            document.createElement(
                'button'
            );

        button.type =
            'button';

        button.id =
            BUTTON_ID;

        button.textContent =
            MULTILANGUAGE
                ? 'Genereer Chantelle-productteksten'
                : 'Genereer Chantelle-producttekst';

        button.style.cssText = `
            display:block;
            margin:0 0 .75em 0;
            padding:.55em .9em;
            cursor:pointer;
            border:1px solid #aaa;
            border-radius:3px;
        `;

        button.addEventListener(
            'click',
            () => generate(
                button
            )
        );

        editorTable
            .parentNode
            .insertBefore(
                button,
                editorTable
            );

        createStatusBox(
            button
        );


        const refresh =
            () => {
                const hidden =
                    !allowedBrand();

                button.hidden =
                    hidden;

                const status =
                    document.getElementById(
                        STATUS_ID
                    );

                if (
                    status &&
                    hidden
                ) {
                    status.style.display =
                        'none';
                }
            };

        document
            .querySelector(
                'select#brand[name="brand_id"]'
            )
            ?.addEventListener(
                'change',
                refresh
            );

        pidInput.addEventListener(
            'input',
            () => {
                button.textContent =
                    MULTILANGUAGE
                        ? 'Genereer Chantelle-productteksten'
                        : 'Genereer Chantelle-producttekst';

                button.style.background =
                    '';

                button.style.borderColor =
                    '';

                button.style.color =
                    '';

                const status =
                    document.getElementById(
                        STATUS_ID
                    );

                if (status) {
                    status.style.display =
                        'none';
                }
            }
        );

        refresh();
    }


    // ============================================================
    // INIT
    // ============================================================

    const observer =
        new MutationObserver(
            installButton
        );

    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );

    installButton();

})();
