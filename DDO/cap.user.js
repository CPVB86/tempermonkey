// ==UserScript==
// @name         DDO | CAP
// @version      2.1
// @description  Kopieer Price, Advice price en VIP-price van tab #1 naar alle relevante velden op tab #3
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/cap.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/cap.user.js
// ==/UserScript==

(function () {
    'use strict';

    const LOG_PREFIX = '[DDO CAP]';

    function loadFontAwesome() {
        if (
            document.querySelector(
                'link[href*="font-awesome"], link[href*="fontawesome"]'
            )
        ) {
            return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href =
            'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';

        document.head.appendChild(link);
    }

    function waitForElement(selector, callback, timeout = 10000) {
        const start = Date.now();

        const check = () => {
            const element = document.querySelector(selector);

            if (element) {
                callback(element);
                return;
            }

            if (Date.now() - start < timeout) {
                setTimeout(check, 200);
            } else {
                console.warn(
                    `${LOG_PREFIX} Element niet gevonden binnen timeout:`,
                    selector
                );
            }
        };

        check();
    }

    function triggerInputEvents(input) {
        input.dispatchEvent(new Event('input', {
            bubbles: true
        }));

        input.dispatchEvent(new Event('change', {
            bubbles: true
        }));
    }

    function fillFields(selector, value) {
        const fields = document.querySelectorAll(selector);

        if (!fields.length) {
            alert('Geen doelvelden gevonden op tab #3.');
            return;
        }

        fields.forEach(input => {
            input.value = value;
            triggerInputEvents(input);
        });

        console.log(
            `${LOG_PREFIX} ${fields.length} velden gevuld met:`,
            value
        );
    }

    /**
     * Zoekt een input naast een td.control met een bepaalde tekst.
     *
     * Voorbeeld:
     * <td class="control">Price (VIP):</td>
     * <td><input ...></td>
     */
    function findInputByLabel(labelText) {
        const cells = document.querySelectorAll('#tabs-1 td.control');

        for (const cell of cells) {
            const text = cell.textContent
                .replace(/\s+/g, ' ')
                .trim()
                .replace(/:$/, '')
                .trim();

            if (text.toLowerCase() !== labelText.toLowerCase()) {
                continue;
            }

            const nextCell = cell.nextElementSibling;
            const input = nextCell?.querySelector('input, select, textarea');

            if (input) {
                return input;
            }

            // Reserveoptie wanneer de input niet direct in de volgende td staat.
            const rowInput = cell
                .closest('tr')
                ?.querySelector('input, select, textarea');

            if (rowInput) {
                return rowInput;
            }
        }

        return null;
    }

    function createButton({
        id,
        title,
        sourceGetter,
        targetSelector,
        missingMessage
    }) {
        const button = document.createElement('button');

        button.type = 'button';
        button.id = id;
        button.innerHTML = '<i class="fa fa-euro-sign"></i>';
        button.title = title;

        Object.assign(button.style, {
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            padding: '3px',
            marginLeft: '4px',
            cursor: 'pointer',
            fontSize: '10px'
        });

        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = 'green';
        });

        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = '#007bff';
        });

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            const sourceInput = sourceGetter();

            if (!sourceInput) {
                alert(missingMessage);
                return;
            }

            fillFields(targetSelector, sourceInput.value);
        });

        return button;
    }

    function addButtons() {
        const headers = document.querySelectorAll(
            '#tabs-3 th.product_option_small'
        );

        if (headers.length < 5) {
            console.warn(
                `${LOG_PREFIX} Onvoldoende kolommen gevonden. Aantal:`,
                headers.length
            );
            return;
        }

        // Price — derde kolom
        if (!document.querySelector('#ddo-cap-price')) {
            headers[2].appendChild(
                createButton({
                    id: 'ddo-cap-price',
                    title: 'Kopieer inkoopprijs naar alle velden',

                    sourceGetter: () =>
                        document.querySelector(
                            '#tabs-1 input.control.price[name="price"]'
                        ) ||
                        document.querySelector(
                            '#tabs-1 input[name="price"]'
                        ) ||
                        findInputByLabel('Price'),

                    targetSelector:
                        '#tabs-3 input[name^="options"][name$="[price]"]',

                    missingMessage:
                        'Geen inkoopprijs gevonden op tab #1!'
                })
            );
        }

        // Advice price — vierde kolom
        if (!document.querySelector('#ddo-cap-advice-price')) {
            headers[3].appendChild(
                createButton({
                    id: 'ddo-cap-advice-price',
                    title: 'Kopieer adviesprijs naar alle velden',

                    sourceGetter: () =>
                        document.querySelector(
                            '#tabs-1 input[name="price_advice"]'
                        ) ||
                        findInputByLabel('Advice price'),

                    targetSelector:
                        '#tabs-3 input[name^="options"][name$="[price_advice]"]',

                    missingMessage:
                        'Geen adviesprijs gevonden op tab #1!'
                })
            );
        }

        // Price (VIP) — vijfde kolom
        if (!document.querySelector('#ddo-cap-vip-price')) {
            headers[4].appendChild(
                createButton({
                    id: 'ddo-cap-vip-price',
                    title: 'Kopieer VIP-prijs naar alle velden',

                    sourceGetter: () =>
                        document.querySelector(
                            '#tabs-1 input[name="price_vip"]'
                        ) ||
                        findInputByLabel('Price (VIP)'),

                    targetSelector:
                        '#tabs-3 input[name^="options"][name$="[price_vip]"]',

                    missingMessage:
                        'Geen VIP-prijs gevonden op tab #1!'
                })
            );
        }

        console.log(`${LOG_PREFIX} Knoppen toegevoegd.`);
    }


    function stretchColumns() {
    const headers = document.querySelectorAll('#tabs-3 th.product_option_small');

    if (headers.length >= 5) {
        headers[2].style.minWidth = '90px';   // Price
        headers[3].style.minWidth = '110px';  // Advice price
        headers[4].style.minWidth = '105px';  // Price (VIP)
    }

    document.querySelectorAll('#tabs-3 input.product_option_small').forEach(input => {
        input.style.minWidth = '90px';
    });
}
    loadFontAwesome();

waitForElement('#tabs-3 th.product_option_small', () => {
    addButtons();
    stretchColumns();
});

    waitForElement(
        '#tabs-3 th.product_option_small',
        addButtons
    );
})();
