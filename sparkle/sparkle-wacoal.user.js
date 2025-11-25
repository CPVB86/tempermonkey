// ==UserScript==
// @name         Sparkle | Wacoal
// @version      1.2
// @description  Voeg een klikbare ✨ toe onder de h1 om .pdp-details HTML te kopiëren
// @match        https://b2b.wacoal-europe.com/b2b/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-wacoal.user.js
// ==/UserScript==

(function () {
    'use strict';

    function insertCopyButton() {
        const pdpDetails = document.querySelector('.pdp-details');
        const heading = pdpDetails?.querySelector('h1');

        if (!pdpDetails || !heading || pdpDetails.querySelector('.copy-sparkle')) return;

        const copyBtn = document.createElement('h5');
        copyBtn.textContent = '✨';
        copyBtn.className = 'copy-sparkle';
        copyBtn.style.cursor = 'pointer';
        copyBtn.style.marginTop = '5px';
        copyBtn.style.fontWeight = 'normal';
        copyBtn.style.fontSize = '14px';
        copyBtn.style.color = '#0073aa';

        copyBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            const html = pdpDetails.outerHTML;
            navigator.clipboard.writeText(html).then(() => {
                console.log('✅ .pdp-details HTML gekopieerd naar klembord.');
            }).catch(err => {
                console.error('❌ Fout bij kopiëren:', err);
            });
        });

        heading.insertAdjacentElement('afterend', copyBtn);
    }

    // Werkt ook bij dynamische pagina-updates
    const observer = new MutationObserver(() => {
        insertCopyButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Probeer direct
    insertCopyButton();
})();
