// ==UserScript==
// @name         DDO | 3=2 Correctietool
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=returns&action=view&id=*
// @grant        none
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/3is2correctietool.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/3is2correctietool.user.js
// ==/UserScript==

(function () {
  'use strict';

  const parseMoney = txt =>
    parseFloat(txt.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;

  const formatMoney = num =>
    '€ ' + num.toFixed(2).replace('.', ',');

  const promoRows = [...document.querySelectorAll('tr')].filter(row =>
    row.querySelector('img[src="img/icon/money_dollar.png"][title="Promo"]')
  );

  const items = promoRows.map(row => {
    const cells = row.querySelectorAll('td');
    const name = cells[0]?.innerText.trim().split('\n')[0] || 'Onbekend';
    const count = parseInt(cells[1]?.innerText.trim(), 10) || 0;
    const price = parseMoney(cells[2]?.innerText || '');
    return { row, name, count, price };
  }).filter(item => item.price > 0);

  const expanded = [];
  items.forEach(item => {
  const originalQty = 1;          // item deed oorspronkelijk mee
  const returnedQty = item.count; // retouraantal
  const remainingQty = Math.max(originalQty - returnedQty, 0);

  for (let i = 0; i < remainingQty; i++) {
    expanded.push(item);
  }
});

  expanded.sort((a, b) => b.price - a.price);

  let discount = 0;
  const freeItems = [];

  for (let i = 0; i + 2 < expanded.length; i += 3) {
    const group = expanded.slice(i, i + 3);
    const freeItem = group[2]; // goedkoopste van de 3 duurste
    discount += freeItem.price;
    freeItems.push(freeItem);
  }

  freeItems.forEach(item => {
    item.row.style.background = '#fff3cd';
    item.row.title = 'Gratis item binnen 3 halen 2 betalen';
  });

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

const originalExpanded = [];
const returnedExpanded = [];

items.forEach(item => {
  originalExpanded.push(item);

  if (item.count < 1) {
    returnedExpanded.push(item);
  }
});

const oldCalc = calcDiscount(originalExpanded);
const newCalc = calcDiscount(returnedExpanded);

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

    Promo-items na retour: ${returnedExpanded.length}<br>
    Gratis items na herberekening: ${newCalc.freeItems.length}<br>
    Korting: <strong>${formatMoney(newCalc.discount)}</strong><br><br>

    Te corrigeren: <strong>${formatMoney(correction)}</strong>
  `;

}

  const returnContent = [...document.querySelectorAll('h2')]
    .find(h2 => h2.innerText.includes('Return content'));

  returnContent?.parentElement?.prepend(box);

})();
