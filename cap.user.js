// ==UserScript==
// @name         CAP
// @version      1.8
// @description  Copy Advice Price van tab#1 naar relevante velden op tab#3
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/cap.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/cap.user.js
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

    function createButton() {
        const button = document.createElement('button');
        button.innerHTML = '<i class="fa fa-euro-sign"></i>';
        button.title = 'Kopieer adviesprijs naar alle velden';

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
            const prijsInput = document.querySelector('#tabs-1 input[name="price_advice"]');
            if (!prijsInput) {
                alert('Geen adviesprijs gevonden op tab #1!');
                return;
            }

            const prijs = prijsInput.value;
            const doelvelden = document.querySelectorAll('#tabs-3 input[name^="options"][name$="[price_advice]"]');
            doelvelden.forEach(input => {
                input.value = prijs;
            });
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
        if (allThs.length >= 4) {
            const targetTh = allThs[3]; // vierde kolom (0-based index)
            const button = createButton();
            targetTh.appendChild(button);
        } else {
            console.warn('Minder dan 4 kolommen gevonden in #tabs-3');
        }
    });
})();
