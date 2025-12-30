// ==UserScript==
// @name         DDO | Discount Pill
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      0.1
// @description  Toon kortingspercentage onder de prijs in de productlijst
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/discount-pill.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/discount-pill.user.js
// ==/UserScript==

(function () {
    'use strict';

    const rows = document.querySelectorAll('tr.highlight');

    rows.forEach(tr => {
        // Voorkom dubbele pills
        if (tr.querySelector('.ddo-discount-pill')) return;

        const tds = Array.from(tr.querySelectorAll('td'));
        // Zoek de twee kolommen met een euro-teken: [0] = prijs, [1] = adviesprijs
        const euroCells = tds.filter(td => td.textContent.includes('€'));
        if (euroCells.length < 2) return;

        const priceCell = euroCells[0];
        const adviceCell = euroCells[1];

        const parsePrice = td => {
            const text = td.textContent.replace(/\s/g, '');
            const match = text.match(/([\d.,]+)/);
            if (!match) return null;
            // Maak van "1.234,56" → "1234.56"
            const normalized = match[1].replace(/\./g, '').replace(',', '.');
            const value = parseFloat(normalized);
            return isNaN(value) ? null : value;
        };

        const price = parsePrice(priceCell);
        const advice = parsePrice(adviceCell);

        let discount = 0;
        if (price != null && advice != null && advice > 0 && price < advice) {
            discount = Math.round((1 - price / advice) * 100);
            if (discount < 0) discount = 0;
        }

        const pill = document.createElement('span');
        pill.className = 'ddo-discount-pill';
        pill.textContent = (discount || 0) + '%';
        pill.style.display = 'inline-block';
        pill.style.marginTop = '2px';
        pill.style.padding = '1px 6px';
        pill.style.borderRadius = '999px';
        pill.style.fontSize = '11px';
        pill.style.lineHeight = '1.4';
        pill.style.color = '#fff';
        pill.style.background = discount > 0 ? '#ff8800' : '#000000';

        const wrapper = document.createElement('div');
        wrapper.appendChild(pill);

        // Pill onder de prijs zetten
        priceCell.appendChild(wrapper);
    });
})();
