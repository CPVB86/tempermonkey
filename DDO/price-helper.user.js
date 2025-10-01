// ==UserScript==
// @name         DDO | Price Helper
// @namespace    ddo-tools
// @version      2.0
// @description  Snel Price zetten o.b.v. Advice met % knoppen en slimme highlighting
// @author       you
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @match        http://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/price-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/price-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Inclusief 0% als reset
  const pctList = [0, 10, 20, 30, 40, 50, 60, 70];
  const EPS = 0.01;
  const $ = (s, r = document) => r.querySelector(s);

  function parsePrice(v) {
    if (v == null) return NaN;
    const cleaned = String(v).replace(/[^0-9.,-]/g, '').replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  function formatPrice(n) {
    return (Math.round(n * 100) / 100).toFixed(2); // punt-decimaal
  }
  const computeTarget = (advice, pct) => advice * (1 - pct / 100);
  const approxEqual = (a, b) => Math.abs(a - b) <= EPS;

  function currentPctMatch(advice, price) {
    if (!(advice > 0) || !(price >= 0)) return null;
    for (const pct of pctList) {
      if (approxEqual(price, computeTarget(advice, pct))) return pct;
    }
    return null;
  }

  function addStyles() {
    if (document.getElementById('ddo-price-helpers-css')) return;
    const css = `
      .ddo-price-actions{display:inline-flex;vertical-align:middle;flex-wrap:wrap}
      .ddo-price-btn{font:12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:4px 8px;border-radius:6px;border:1px solid #d0d0d0;background:#eee;color:#333;cursor:pointer;transition:background-color .12s,color .12s,border-color .12s,transform .06s;user-select:none}
      .ddo-price-btn:hover{background:linear-gradient(0deg,#ff7a00 0%,#ffb300 100%);color:#111;border-color:#ff7a00}
      .ddo-price-btn:active{transform:translateY(1px)}
      .ddo-price-btn.active{background:#22c55e;border-color:#16a34a;color:#fff}
    `;
    const el = document.createElement('style');
    el.id = 'ddo-price-helpers-css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function buildButtons() {
    const wrap = document.createElement('span');
    wrap.className = 'ddo-price-actions';
    for (const pct of pctList) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ddo-price-btn';
      btn.dataset.pct = String(pct);
      btn.textContent = `${pct}%`;
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function getCoreFields() {
    const priceInput  = $('input[name="price"]');
    const adviceInput = $('input[name="price_advice"]');
    return { priceInput, adviceInput };
  }

  function updateTooltipsAndHighlights(container, adviceVal, priceVal) {
    const advice = parsePrice(adviceVal);
    const price = parsePrice(priceVal);
    const active = advice > 0 && price >= 0 ? currentPctMatch(advice, price) : null;

    container.querySelectorAll('.ddo-price-btn').forEach(btn => {
      const pct = Number(btn.dataset.pct);
      if (advice > 0) {
        const t = computeTarget(advice, pct);
        btn.title = `= € ${formatPrice(t)} (van € ${formatPrice(advice)})`;
      } else {
        btn.title = 'Vul eerst een geldige Advice price in';
      }
      btn.classList.toggle('active', active === pct);
    });
  }

  function setValueAndDispatch(input, value) {
    input.value = formatPrice(value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyToOptionPrices(targetValue) {
    const optionInputs = document.querySelectorAll('input[type="number"][name^="options["][name$="[price]"]');
    optionInputs.forEach(inp => setValueAndDispatch(inp, targetValue));
  }

  function attach() {
    const { priceInput, adviceInput } = getCoreFields();
    if (!priceInput || !adviceInput) return false;

    addStyles();
    if (priceInput.closest('td.control')?.querySelector('.ddo-price-actions')) return true;

    const container = buildButtons();
    const parentCell = priceInput.closest('td.control') || priceInput.parentElement;
    parentCell.appendChild(container);

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.ddo-price-btn');
      if (!btn) return;
      const pct = Number(btn.dataset.pct);
      const advice = parsePrice(adviceInput.value);
      if (!(advice > 0)) {
        alert('Geen geldige Advice price gevonden.');
        return;
      }
      const target = computeTarget(advice, pct);

      // Zet hoofd Price
      setValueAndDispatch(priceInput, target);

      // Zet alle maat-prijzen (options in #tabs-3)
      applyToOptionPrices(target);

      updateTooltipsAndHighlights(container, adviceInput.value, priceInput.value);
    });

    const onInput = () => updateTooltipsAndHighlights(container, adviceInput.value, priceInput.value);
    adviceInput.addEventListener('input', onInput);
    priceInput.addEventListener('input', onInput);

    updateTooltipsAndHighlights(container, adviceInput.value, priceInput.value);
    return true;
  }

  function initWithRetries(maxTries = 10, delay = 150) {
    let tries = 0;
    const tick = () => {
      tries++;
      if (attach()) return;
      if (tries < maxTries) setTimeout(tick, delay);
    };
    tick();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initWithRetries();
  } else {
    document.addEventListener('DOMContentLoaded', () => initWithRetries(), { once: true });
  }
})();
