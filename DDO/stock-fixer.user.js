// ==UserScript==
// @name         DDO | Fix Stock
// @version      1.3
// @description  Zet alle stockwaarden van '1' in #tabs-3 naar '0' met één klik. Knop alleen zichtbaar als tab 3 actief is.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/stock-fixer.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/stock-fixer.user.js
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  let btn;
  let scheduled = false;
  let lastState = { active: false, hasOne: false, inputsCount: 0 };

  const BTN_ID = "fixstock-btn";

  const btnStyles = (enabled) => `
    position: fixed;
    right: 10px;
    top: 170px;
    z-index: 9999;
    padding: 10px 12px;
    background: ${enabled ? "#007cba" : "#2ecc71"};
    color: #fff;
    border: none;
    border-radius: 6px;
    font: 600 14px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    cursor: ${enabled ? "pointer" : "default"};
    box-shadow: 0 4px 10px rgba(0,0,0,.12);
  `;

  // ——— helpers ———
  function isTab3Active() {
    // Zoek de tab-link naar #tabs-3 en check of die actief/selected is
    const link = document.querySelector('a[href="#tabs-3"]');
    if (!link) return false;
    const li = link.closest('li,[role="tab"]');
    if (!li) return false;
    const aria = (li.getAttribute('aria-selected') || '').toLowerCase();
    return li.classList.contains('ui-tabs-active') || aria === 'true';
  }

  function getStockInputs() {
    const tab = document.querySelector("#tabs-3");
    if (!tab) return [];
    return [...tab.querySelectorAll('input[name*="[stock]"]')]
      .filter(input => !input.disabled && !input.readOnly);
  }

  function ensureButton() {
    if (btn) return btn;
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = BTN_ID;
    btn.setAttribute("data-fixstock", "1");
    btn.addEventListener("click", onClick);
    const attach = () => (document.body || document.documentElement).appendChild(btn);
    if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach, { once: true });
    return btn;
  }

  // ——— actions ———
  function onClick() {
    if (!isTab3Active()) return;
    const inputs = getStockInputs();
    let changed = 0;

    inputs.forEach(input => {
      if (String(input.value).trim() === "1") {
        input.value = "0";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        changed++;
      }
    });

    ensureButton();
    btn.textContent = `🔧 ${changed} stocks aangepast naar 0`;
    btn.style.cssText = btnStyles(false);
    btn.disabled = true;

    requestUpdate();
  }

  // ——— UI ———
  function updateUI() {
    scheduled = false;

    const active = isTab3Active();
    if (!active) {
      if (btn) btn.style.display = "none";
      lastState = { active: false, hasOne: false, inputsCount: 0 };
      return;
    }

    const inputs = getStockInputs();
    const hasOne = inputs.some(i => String(i.value).trim() === "1");
    const inputsCount = inputs.length;

    if (
      lastState.active !== active ||
      lastState.hasOne !== hasOne ||
      lastState.inputsCount !== inputsCount
    ) {
      ensureButton();
      btn.style.display = "block";
      btn.textContent = hasOne ? "🧯 Fix Stock" : "✅ Stock is OK!";
      btn.style.cssText = btnStyles(hasOne);
      btn.disabled = !hasOne;

      lastState = { active, hasOne, inputsCount };
    }
  }

  function requestUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateUI);
  }

  // ——— observers ———
  function initObserver() {
    const observer = new MutationObserver((mutations) => {
      // Sla mutaties over die alleen onze knop raken
      const relevant = mutations.some(m => {
        if (!m.target) return true;
        const node = m.target.nodeType === 1 ? m.target : null;
        return !(node && node.closest && node.closest(`#${CSS.escape(BTN_ID)}`));
      });
      if (!relevant) return;
      requestUpdate();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
      // geen attributes -> voorkomt loops/flicker
    });

    // Tab-wissels via UI of hash
    window.addEventListener("hashchange", requestUpdate);
    document.addEventListener("visibilitychange", requestUpdate);

    // Fallback: elke 1000ms even syncen (mocht observer iets missen)
    setInterval(requestUpdate, 1000);
  }

  // ——— boot ———
  function boot() {
    initObserver();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", requestUpdate, { once: true });
    } else {
      requestUpdate();
    }
  }

  boot();
})();
