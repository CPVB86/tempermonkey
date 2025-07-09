// ==UserScript==
// @name         NIS
// @version      1.7
// @description  Never In Stock - kopieert de EAN en Stock van producten
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/nis.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/nis.user.js
// ==/UserScript==

(function () {
    'use strict';

    function loadFontAwesome() {
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fontawesome"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
            document.head.appendChild(link);
        }
    }

    function createCopyButton() {
        const button = document.createElement('button');
        button.innerHTML = '<i class="fa fa-copy"></i>';
        button.title = 'Kopieer EAN + Stock naar klembord';

        Object.assign(button.style, {
            backgroundColor: '#007bff',
            color: 'white',
            borderRadius: '5px',
            padding: '3px 3px',
            cursor: 'pointer',
            fontSize: '10px',
        });

        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = 'green';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = '#007bff';
        });

        button.addEventListener('click', () => {
            const rows = [];

            const eanFields = document.querySelectorAll('#tabs-3 input[name^="options"][name$="[barcode]"]');
            const stockFields = document.querySelectorAll('#tabs-3 input[name^="options"][name$="[stock]"]');

            if (eanFields.length !== stockFields.length) {
                console.warn('Aantal EANs en stockvelden komt niet overeen!');
                return;
            }

            for (let i = 0; i < eanFields.length; i++) {
                const ean = eanFields[i].value.trim();
                const stock = stockFields[i].value.trim();
                if (ean !== '') {
                    rows.push(`${ean}\t${stock}`);
                }
            }

            const output = rows.join('\n');
            if (typeof GM_setClipboard !== 'undefined') {
                GM_setClipboard(output);
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(output).catch(() => {
                    console.warn('Kopiëren naar klembord mislukt.');
                });
            }
        });

        return button;
    }

    function waitForElement(selector, callback, timeout = 10000) {
        const start = Date.now();
        const check = () => {
            const el = document.querySelector(selector);
            if (el) {
                callback(el);
            } else if (Date.now() - start < timeout) {
                setTimeout(check, 200);
            }
        };
        check();
    }

    loadFontAwesome();
    waitForElement('#tabs-3 th.product_option_small', () => {
        const allThs = document.querySelectorAll('#tabs-3 th.product_option_small');
        if (allThs.length >= 6) {
            const targetTh = allThs[5];
            const button = createCopyButton();
            targetTh.appendChild(button);
        }
    });
})();
