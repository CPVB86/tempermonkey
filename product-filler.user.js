// ==UserScript==
// @name         Vul productdata automatisch in met knop
// @version      1.6
// @description  Plakt HTML uit het klembord en vult automatisch de velden op de backend in
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/product-filler.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/product-filler.user.js
// ==/UserScript==

(function () {
    'use strict';

    const observer = new MutationObserver(() => {
        const tab1 = document.querySelector('#tabs-1');
        const messageBestaatAl = document.querySelector('#magicMsg');
        if (tab1 && !messageBestaatAl) addMagicMessage();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function addMagicMessage() {
        const h2 = document.querySelector('#tabs-1 h2');
        if (!h2) return;

        const msg = document.createElement('div');
        msg.id = 'magicMsg';
        msg.textContent = '✨';
        Object.assign(msg.style, {
            fontSize: '1.2em',
            fontWeight: 'bold',
            color: '#d35400',
            marginTop: '10px',
            marginBottom: '10px'
        });

        h2.insertAdjacentElement('afterend', msg);
    }

    document.addEventListener('click', async (e) => {
        if (e.target.id !== 'magicMsg') return;

        console.clear();
        console.log("▶️ Start script");

        try {
            const nameInput = document.querySelector('input[name="name"]');
            const localName = nameInput?.value.trim() || '';

            const html = await navigator.clipboard.readText();
            console.log("📋 HTML gekopieerd:", html.slice(0, 300));

            const dom = new DOMParser().parseFromString(html, 'text/html');
            const name = dom.querySelector('.pdp-details_heading')?.textContent.trim() || '';
            console.log("🧾 Naam leverancier:", name);

            const priceText = dom.querySelector('.pdp-details_price__discounted')?.textContent.replace(/[^\d,\.]/g, '') || '0.00';
            const rrpText = dom.querySelector('.pdp-details_price__offer')?.textContent.replace(/[^\d,\.]/g, '') || '0.00';
            const price = priceText.replace(',', '.');
            const rrp = rrpText.replace(',', '.');

            const productCode = [...dom.querySelectorAll('.pdp-details_product-code')]
                .find(p => p.textContent.includes('Product Code'))
                ?.querySelector('span')?.textContent.trim() || '';

            const aMatch = dom.querySelector('a');
            const reference = aMatch ? ` - [ext]` : '';

            const set = (selector, value) => {
                const el = document.querySelector(selector);
                if (el) el.value = value;
            };

            const fullTitle = `${localName} ${name}`.trim();

            set('input[name="name"]', fullTitle);
            set('input[name="title"]', fullTitle);
            set('input[name="price"]', rrp);
            set('input[name="price_advice"]', rrp);
            set('input[name="price_vip"]', '0.00');
            set('input[name="supplier_pid"]', productCode);
            set('input[name="reference"]', reference);

            const publicNo = document.querySelector('input[name="public"][value="0"]');
            if (publicNo) publicNo.checked = true;

            const deliverySelect = document.querySelector('select[name="delivery"]');
            if (deliverySelect) {
                deliverySelect.value = '1-2d';
                deliverySelect.dispatchEvent(new Event('change', { bubbles: true }));
            }

            const brandSelect = document.querySelector('select[name="brand_id"]');
            if (brandSelect) {
                const match = [...brandSelect.options].find(opt =>
                    opt.text.trim().toLowerCase() === localName.toLowerCase());
                if (match) {
                    brandSelect.value = match.value;
                    brandSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    selectModel(name);
                }
            }

            const tagInput = document.querySelector('input[name="tags_csv"]');
            if (tagInput) {
                tagInput.value = 'SYST - Promo, SYST - Extern, SYST - Webwinkelkeur, PROD.AND - Curvy';
                console.log("🏷️ Tags ingevuld via inputveld");
            }

            console.log('✅ Klaar!');

        } catch (err) {
            console.error("❌ Fout:", err);
        }
    });

    function selectModel(name) {
        const maxWaitTime = 5000;
        const intervalTime = 200;
        let waited = 0;

        const nameLower = name.toLowerCase();

        const interval = setInterval(() => {
            const modelSelect = document.querySelector('select[name="model_id"]');
            if (modelSelect && modelSelect.options.length > 1) {
                let bestMatch = null;
                let bestScore = 0;

                [...modelSelect.options].forEach(opt => {
                    const optionText = opt.textContent.toLowerCase();
                    if (!optionText) return;

                    const words = optionText.split(/[^a-z0-9]+/);
                    let score = words.reduce((acc, word) => acc + (nameLower.includes(word) ? 1 : 0), 0);

                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = opt;
                    }
                });

                if (bestMatch && bestScore > 0) {
                    modelSelect.value = bestMatch.value;
                    $(modelSelect).trigger('change');
                    console.log(`✅ Beste modelmatch: ${bestMatch.textContent} (score: ${bestScore})`);
                } else {
                    console.warn(`⚠️ Geen geschikte modelmatch gevonden in: "${name}"`);
                }

                clearInterval(interval);
            }

            waited += intervalTime;
            if (waited >= maxWaitTime) {
                console.warn("⏰ Timeout bij zoeken naar model-selectie");
                clearInterval(interval);
            }
        }, intervalTime);
    }

})();
