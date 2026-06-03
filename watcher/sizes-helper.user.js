// ==UserScript==
// @name         DDO | Brand Watcher - Size Helper
// @version      0.1.1
// @description  Plakt ontbrekende maten vanuit het klembord in de DDO productmaat-selectie.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/watcher/sizes-helper.user.js?v=0.1.1
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/watcher/sizes-helper.user.js?v=0.1.1
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const READY_ATTR = "data-ddo-sizes-helper-ready";
  const normalizeOption = (raw) => {
    const value = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
    if (value === "ONESIZE" || value === "ONE-SIZE" || value === "NO-SIZE") return "NOSIZE";
    return value;
  };
  const parseClipboardSizes = (text) => [...new Set(
    String(text || "")
      .split(/[\n\t,;|]+/)
      .map((size) => size.trim())
      .filter(Boolean)
  )];

  function injectStyles() {
    if (document.getElementById("ddo-sizes-helper-style")) return;
    const style = document.createElement("style");
    style.id = "ddo-sizes-helper-style";
    style.textContent = `
      .ddo-sizes-helper {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        margin-left: 8px;
      }
      .ddo-sizes-helper-button {
        padding: 5px 8px;
        border: 1px solid #b8adc9;
        border-radius: 5px;
        background: #fff;
        color: #3f3656;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }
      .ddo-sizes-helper-status {
        color: #6b617d;
        font-size: 11px;
        line-height: 1.35;
        max-width: 520px;
      }
      .ddo-sizes-helper-status.warn {
        color: #9a5b10;
      }
      .ddo-sizes-helper-status.bad {
        color: #9a253f;
      }
    `;
    document.head.appendChild(style);
  }

  function findSelect2Container(select) {
    const next = select.nextElementSibling;
    if (next?.matches?.(".select2-container")) return next;
    return select.parentElement?.querySelector?.(".select2-container") || null;
  }

  function findSelectForContainer(container) {
    const previous = container?.previousElementSibling;
    if (previous?.matches?.("select[multiple]")) return previous;
    return container?.parentElement?.querySelector?.("select[multiple]") || null;
  }

  function isSizeSelect(select) {
    if (!select?.matches?.("select[multiple]")) return false;
    const name = String(select.getAttribute("name") || "").toLowerCase();
    if (name === "sizes[]" || name === "sizes") return true;
    return false;
  }

  async function readClipboardText() {
    if (navigator.clipboard?.readText) {
      try {
        return await navigator.clipboard.readText();
      } catch {}
    }
    return window.prompt("Plak de ontbrekende maten:", "") || "";
  }

  function selectWantedSizes(select, wanted) {
    const options = [...select.options];
    const byLabel = new Map(options.map((option) => [
      normalizeOption(option.textContent || ""),
      option
    ]));
    const missing = [];
    let matched = 0;

    for (const size of wanted) {
      const option = byLabel.get(normalizeOption(size));
      if (!option) {
        missing.push(size);
        continue;
      }
      option.selected = true;
      matched++;
    }

    select.dispatchEvent(new Event("change", { bubbles: true }));
    if (window.jQuery) window.jQuery(select).trigger("change");
    return { matched, missing };
  }

  function attachButton(select) {
    if (!isSizeSelect(select) || select.getAttribute(READY_ATTR) === "1") return;
    const container = findSelect2Container(select);
    if (!container) return;

    const wrapper = document.createElement("span");
    wrapper.className = "ddo-sizes-helper";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ddo-sizes-helper-button";
    button.textContent = "Plak ontbrekende maten";

    const status = document.createElement("span");
    status.className = "ddo-sizes-helper-status";
    status.setAttribute("aria-live", "polite");

    button.addEventListener("click", async () => {
      const originalText = button.textContent;
      status.textContent = "";
      status.className = "ddo-sizes-helper-status";
      try {
        const wanted = parseClipboardSizes(await readClipboardText());
        if (!wanted.length) {
          status.textContent = "Geen maten gevonden op het klembord.";
          status.classList.add("bad");
          return;
        }
        const { matched, missing } = selectWantedSizes(select, wanted);
        button.textContent = `${matched}/${wanted.length} geselecteerd`;
        if (missing.length) {
          status.textContent = `Niet beschikbaar in DDO: ${missing.join(", ")}`;
          status.title = missing.join("\n");
          status.classList.add("warn");
        } else {
          status.textContent = "Alle maten geselecteerd.";
        }
      } catch (error) {
        console.error("[DDO-SIZES-HELPER] Klembord plakken mislukt", error);
        status.textContent = "Klembord lezen mislukt.";
        status.classList.add("bad");
      }
      setTimeout(() => { button.textContent = originalText; }, 2600);
    });

    wrapper.append(button, status);
    container.insertAdjacentElement("afterend", wrapper);
    select.setAttribute(READY_ATTR, "1");
  }

  function removeLegacyButtons() {
    for (const button of document.querySelectorAll("button")) {
      if (button.classList.contains("ddo-sizes-helper-button")) continue;
      if (!/plak ontbrekende maten/i.test(button.textContent || "")) continue;

      const container = button.previousElementSibling?.matches?.(".select2-container")
        ? button.previousElementSibling
        : null;
      const select = findSelectForContainer(container);
      if (container) delete container.dataset.watcherPasteReady;
      if (!select || !isSizeSelect(select)) {
        button.remove();
        continue;
      }

      // De oude knop werkte vanuit het Chantelle-script. Vervang hem door deze algemene helper.
      button.remove();
      select.removeAttribute(READY_ATTR);
    }
  }

  function attachButtons() {
    injectStyles();
    removeLegacyButtons();
    for (const select of document.querySelectorAll('select[name="sizes[]"][multiple], select[name="sizes"][multiple]')) {
      attachButton(select);
    }
  }

  attachButtons();
  new MutationObserver(attachButtons).observe(document.body, { childList: true, subtree: true });
})();
