// ==UserScript==
// @name         DDO | Update Flow
// @namespace    ddo-tools
// @version      3.0
// @description  Navigeer na update o.b.v. actieve jQuery UI tab; geen reliance op URL-hash.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @run-at       document-idle
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/update-flow.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/update-flow.user.js
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "ddo_next_nav_after_update_v30"; // {createdAt, targetTabId?, scroll?('top'|'bottom'), doAutoCheck?}
  const PLAN_TTL_MS = 2 * 60 * 1000; // safety TTL
  const DEBUG = false;
  const log = (...a) => DEBUG && console.debug("[DDO v3.0]", ...a);

  // Geldt alleen op product bewerkpagina
  const url = new URL(location.href);
  const isEditPage =
    url.pathname.endsWith("/admin.php") &&
    url.searchParams.get("section") === "products" &&
    url.searchParams.get("action") === "edit";
  if (!isEditPage) return;

  // ---------- Helpers ----------
  const now = () => Date.now();

  function readPlan() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const plan = JSON.parse(raw);
      if (!plan?.createdAt || now() - plan.createdAt > PLAN_TTL_MS) {
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return plan;
    } catch { return null; }
  }
  function writePlan(plan) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...plan, createdAt: now() }));
    log("Plan set:", plan);
  }
  function clearPlan() {
    sessionStorage.removeItem(STORAGE_KEY);
    log("Plan cleared");
  }

  // Actieve tab bepalen via nav
  function getActiveTabId() {
    const li =
      document.querySelector('.ui-tabs-nav li[aria-selected="true"]') ||
      document.querySelector('.ui-tabs-nav li.ui-tabs-active.ui-state-active');
    if (!li) return null;
    // Voorkeur: aria-controls (zoals in jouw HTML)
    const ctrl = li.getAttribute("aria-controls");
    if (ctrl) return ctrl;
    // Fallback: het anker binnen li
    const a = li.querySelector('a.ui-tabs-anchor[href^="#"]');
    if (a) return (a.getAttribute("href") || "").replace(/^#/, "");
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  function waitFor(condition, { tries = 120, intervalMs = 125 } = {}) {
    return new Promise((resolve, reject) => {
      let n = 0;
      const tick = () => {
        try { if (condition()) return resolve(true); } catch {}
        if (n++ >= tries) return reject(new Error("waitFor timeout"));
        setTimeout(tick, intervalMs); // werkt ook in achtergrondtabs
      };
      tick();
    });
  }

  function clickTabLink(id) {
    const link = document.querySelector(`.ui-tabs-nav a.ui-tabs-anchor[href="#${id}"]`);
    if (link) {
      link.click();
      log("Clicked tab link:", id);
      return true;
    }
    return false;
  }

  async function ensureOnTab(id) {
    // Al goed?
    const panel = document.getElementById(id);
    const activeId = getActiveTabId();
    if (activeId === id && panel && isVisible(panel) && panel.getAttribute("aria-hidden") !== "true") {
      return;
    }
    // Activeer via nav-link
    clickTabLink(id);
    // Wacht tot nav en panel matchen
    await waitFor(() => {
      const current = getActiveTabId();
      const p = document.getElementById(id);
      const hidden = p?.getAttribute("aria-hidden") === "true";
      return current === id && !!p && !hidden && isVisible(p);
    }, { tries: 160, intervalMs: 100 });
  }

  // Scroll hele pagina (niet naar anchors)
  function scrollPage(where /* 'top'|'bottom' */) {
    const doScroll = () => {
      if (where === "top") {
        window.scrollTo({ top: 0, behavior: "auto" });
      } else {
        const doc = document.documentElement;
        const maxTop = Math.max(0, doc.scrollHeight - window.innerHeight);
        window.scrollTo({ top: maxTop, behavior: "auto" });
      }
    };
    // Meerdere pogingen ivm late layout
    doScroll();
    setTimeout(doScroll, 120);
    setTimeout(doScroll, 360);
    setTimeout(doScroll, 800);
  }

  // Autocheck alleen binnen #tabs-3
  async function autoCheckOptionsDeleteInTab3() {
    const scope = document.getElementById("tabs-3") || document;
    await waitFor(() =>
      scope.querySelectorAll('input[type="checkbox"][name="options_delete[]"]').length > 0
    );
    const boxes = scope.querySelectorAll(
      'input[type="checkbox"][name="options_delete[]"]:not(:disabled)'
    );
    boxes.forEach(cb => {
      if (!cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    log("Autocheck in tabs-3:", boxes.length, "boxes considered");
  }

  async function performPlan() {
    const plan = readPlan();
    if (!plan) return;

    try {
      if (plan.targetTabId) {
        await ensureOnTab(plan.targetTabId);
      }
      if (plan.doAutoCheck && plan.targetTabId === "tabs-3") {
        await autoCheckOptionsDeleteInTab3();
      }
      if (plan.scroll === "top" || plan.scroll === "bottom") {
        scrollPage(plan.scroll);
      }
      clearPlan();
    } catch (e) {
      // In achtergrondtab kan dit later pas lukken; we proberen opnieuw bij visibilitychange.
      log("performPlan error, will retry later:", e?.message);
    }
  }

  // ----- Mapping o.b.v. ACTIEVE NAV-TAB -----
  function makePlanFromActiveTab() {
    const active = getActiveTabId();
    if (active === "tabs-2") {
      // tabs-2 → tabs-3
      return { targetTabId: "tabs-3" };
    }
    if (active === "tabs-3") {
      // tabs-3 → tabs-3 + scroll top + autocheck
      return { targetTabId: "tabs-3", scroll: "top", doAutoCheck: true };
    }
    // tabs-1/geen (of iets anders) → tabs-2 + scroll bottom
    return { targetTabId: "tabs-2", scroll: "bottom" };
  }

  function wireUpdateButtons() {
    const buttons = document.querySelectorAll(
      'input.controlbutton[type="submit"][name="edit"]'
    );
    if (!buttons.length) return;

    buttons.forEach(btn => {
      if (btn.dataset.ddoWired === "1") return;
      btn.dataset.ddoWired = "1";

      const form = btn.form || btn.closest("form");
      if (!form) return;

      const markPlan = () => {
        const plan = makePlanFromActiveTab();
        writePlan(plan);
      };

      // Markeer VOOR submit (capture), zodat plan er al is bij reload
      btn.addEventListener("click", markPlan, { capture: true });
      form.addEventListener("submit", markPlan, { capture: true });
    });
  }

  // Init
  wireUpdateButtons();

  const kick = () => performPlan();
  document.addEventListener("DOMContentLoaded", kick);
  window.addEventListener("load", kick);
  window.addEventListener("pageshow", kick);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });
  // extra retries voor background throttling
  setTimeout(kick, 1000);
  setTimeout(kick, 3000);
})();
