// ==UserScript==
// @name         3 halen 2 betalen
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=returns&action=view&id=*
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=returns&action=line_add&id=*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/correctie-returns-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/correctie-returns-loader.user.js
// ==/UserScript==

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);

  const parseMoney = txt =>
    parseFloat(txt.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;

  const formatMoney = num =>
    '€ ' + num.toFixed(2).replace('.', ',');

  const formatInputPrice = num =>
    num.toFixed(2);

  const calcDiscount = list => {
    const sorted = [...list].sort((a, b) => b.price - a.price);
    let discount = 0;
    const freeItems = [];

    for (let i = 0; i + 2 < sorted.length; i += 3) {
      const freeItem = sorted[i + 2];
      discount += freeItem.price;
      freeItems.push(freeItem);
    }

    return { discount, freeItems };
  };

  // Line add-pagina automatisch invullen
  if (params.get('section') === 'returns' && params.get('action') === 'line_add') {
    const correction = sessionStorage.getItem('ddo_3h2p_correction');
    const description = sessionStorage.getItem('ddo_3h2p_description');

    if (correction) {
      const descInput = document.querySelector('input[name="description"]');
      const priceInput = document.querySelector('input[name="price"]');
      const submitBtn = document.querySelector('input[name="lineadd"]');

      if (descInput) descInput.value = description || 'Correctie 3 halen 2 betalen';
      if (priceInput) priceInput.value = correction;

      sessionStorage.removeItem('ddo_3h2p_correction');
      sessionStorage.removeItem('ddo_3h2p_description');

      setTimeout(() => {
        submitBtn?.click();
      }, 250);
    }

    return;
  }

  // View-pagina analyseren
  const returnContent = [...document.querySelectorAll('h2')]
    .find(h2 => h2.innerText.includes('Return content'));

  const productsTable = returnContent
    ?.nextElementSibling
    ?.querySelector('td:nth-child(2) table');

  if (!productsTable) return;

  const promoRows = [...productsTable.querySelectorAll('tr')].filter(row =>
    row.querySelector('img[src="img/icon/money_dollar.png"][title="Promo"]')
  );

  const items = promoRows.map(row => {
    const cells = row.querySelectorAll('td');

    return {
      row,
      name: cells[0]?.innerText.trim().split('\n')[0] || 'Onbekend',
      count: parseInt(cells[1]?.innerText.trim(), 10) || 0,
      price: parseMoney(cells[2]?.innerText || '')
    };
  }).filter(item => item.price > 0);

  const originalExpanded = [];
  const remainingExpanded = [];

  items.forEach(item => {
    const originalQty = item.count > 0 ? item.count : 1;
    const remainingQty = item.count > 0 ? 0 : 1;

    for (let i = 0; i < originalQty; i++) {
      originalExpanded.push(item);
    }

    for (let i = 0; i < remainingQty; i++) {
      remainingExpanded.push(item);
    }
  });

  const oldCalc = calcDiscount(originalExpanded);
  const newCalc = calcDiscount(remainingExpanded);
  const correction = oldCalc.discount - newCalc.discount;

  const box = document.createElement('div');
  box.style.cssText = `
    margin: 15px 0;
    padding: 12px;
    border: 2px solid #f0ad4e;
    background: #fff8e5;
    font: 14px Arial, sans-serif;
  `;

  const addLineLink = [...document.querySelectorAll('a[href*="action=line_add"]')][0];

  if (originalExpanded.length === 0) {
    box.innerHTML = `
      <strong>3 halen 2 betalen retourcorrectie</strong><br><br>
      Geen promo-items gevonden.
    `;
  } else {
    box.innerHTML = `
      <strong>3 halen 2 betalen retourcorrectie</strong><br><br>

      Promo-items oorspronkelijk: ${originalExpanded.length}<br>
      Gratis items: ${oldCalc.freeItems.length}<br>
      Korting: <strong>${formatMoney(oldCalc.discount)}</strong><br><br>

      Promo-items na retour: ${remainingExpanded.length}<br>
      Gratis items na herberekening: ${newCalc.freeItems.length}<br>
      Korting: <strong>${formatMoney(newCalc.discount)}</strong><br><br>

      Te corrigeren: <strong>${formatMoney(correction)}</strong><br><br>
    `;

    if (addLineLink && correction > 0.009) {
      const btn = document.createElement('input');
btn.type = 'button';
btn.value = 'Correctie Toepassen';
btn.className = 'controlbutton';

      const nativeBtn = document.querySelector('.controlbutton');
      if (nativeBtn) {
        btn.style.fontSize = getComputedStyle(nativeBtn).fontSize;
      }

      btn.addEventListener('click', () => {
        sessionStorage.setItem(
          'ddo_3h2p_correction',
          formatInputPrice(-Math.abs(correction))
        );

        sessionStorage.setItem(
          'ddo_3h2p_description',
          'Correctie 3 halen 2 betalen'
        );

        window.location.href = addLineLink.href;
      });

      box.appendChild(btn);
    }
  }

  oldCalc.freeItems.forEach(item => {
    item.row.style.background = '#fff3cd';
  });

  returnContent.parentElement.prepend(box);

})();
