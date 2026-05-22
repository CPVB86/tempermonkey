// ==UserScript==
// @name         3 halen 2 betalen
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=returns&action=view&id=*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const parseMoney = txt =>
    parseFloat(txt.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;

  const formatMoney = num =>
    '€ ' + num.toFixed(2).replace('.', ',');

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
    const originalQty = 1;
    const returnedQty = item.count;
    const remainingQty = Math.max(originalQty - returnedQty, 0);

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

      Te corrigeren: <strong>${formatMoney(correction)}</strong>
    `;
  }

  oldCalc.freeItems.forEach(item => {
    item.row.style.background = '#fff3cd';
  });

  returnContent.parentElement.prepend(box);

})();
