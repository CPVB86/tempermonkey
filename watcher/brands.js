(() => {
      "use strict";

      const state = {
        runId: "",
        running: false,
        paused: false,
        results: [],
        message: "Klaar om te starten.",
        adapters: new Set(),
        inventoryReady: false,
        inventoryCount: 0,
        inventory: []
      };

      const $ = (selector) => document.querySelector(selector);
      const els = {
        start: $("#start"),
        loadDdo: $("#load-ddo"),
        downloadBrand: $("#download-brand"),
        importDdo: $("#import-ddo"),
        ddoFile: $("#ddo-file"),
        saveSession: $("#save-session"),
        importSession: $("#import-session"),
        sessionFile: $("#session-file"),
        clear: $("#clear"),
        csv: $("#csv"),
        status: $("#status"),
        statusText: $("#status-text"),
        filter: $("#filter"),
        brandFilter: $("#brand-filter"),
        results: $("#results"),
        empty: $("#empty"),
        countProducts: $("#count-products"),
        countIssues: $("#count-issues"),
        countSizes: $("#count-sizes"),
        countAdvice: $("#count-advice"),
        countDdoDiscount: $("#count-ddo-discount"),
        countMissedDiscount: $("#count-missed-discount"),
        countSupplierDiscount: $("#count-supplier-discount"),
        countNotOrderable: $("#count-not-orderable"),
        countSkipped: $("#count-skipped")
      };
      const WARNING_LABELS = {
        sizes: "Ontbrekende maten",
        advice: "Adviesprijs wijkt af",
        ddoDiscount: "DDO meer korting",
        missedDiscount: "Korting leverancier gemist",
        supplierDiscount: "Leverancier meer korting",
        notOrderable: "Niet bestelbaar",
        skipped: "Overgeslagen"
      };

      const asList = (value) => Array.isArray(value) ? value : [];
      const asNumber = (value) => {
        if (value === "" || value === null || value === undefined) return null;
        const number = Number(String(value).replace(",", "."));
        return Number.isFinite(number) ? number : null;
      };
      const money = (value) => {
        const number = asNumber(value);
        return number === null ? "" : number.toLocaleString("nl-NL", {
          style: "currency",
          currency: "EUR"
        });
      };
      const differs = (a, b) => {
        const left = asNumber(a);
        const right = asNumber(b);
        return left !== null && right !== null && Math.abs(left - right) >= .005;
      };
      const isDiscounted = (price, rrp) => {
        const current = asNumber(price);
        const advised = asNumber(rrp);
        return current !== null && advised !== null && current < advised - .005;
      };
      const discountPercentage = (price, rrp) => {
        const current = asNumber(price);
        const advised = asNumber(rrp);
        if (current === null || advised === null || advised <= 0 || current >= advised - .005) return "-";
        return `${Math.round((1 - current / advised) * 100)}%`;
      };
      const discountValue = (price, rrp) => {
        const current = asNumber(price);
        const advised = asNumber(rrp);
        if (current === null || advised === null || advised <= 0) return null;
        return current >= advised - .005 ? 0 : Math.round((1 - current / advised) * 100);
      };
      const percentage = (value) => {
        const number = asNumber(value);
        return number === null ? "" : `${Math.round(number)}%`;
      };
      const asBoolean = (value) => value === true || value === 1 || String(value).toLowerCase() === "true";
      const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]);
      const link = (href, label) => label
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
        : "";
      const statusIcon = (status, productId) => {
        if (status === "checked") return '<sup class="check-status checked" title="Gecontroleerd">&#10003;</sup>';
        if (status === "skipped") return `<sup class="check-status skipped"><button class="retry-check" type="button" data-product-id="${escapeHtml(productId)}" title="Alleen dit item opnieuw controleren">&#8635;</button></sup>`;
        return '<sup class="check-status" aria-hidden="true">&nbsp;</sup>';
      };

      function normalizeResult(raw) {
        const result = {
          brand: String(raw.brand || ""),
          productId: String(raw.productId || raw.id || ""),
          supplierUrl: String(raw.supplierUrl || ""),
          warehouseId: String(raw.warehouseId || ""),
          checkStatus: String(raw.checkStatus || "pending"),
          productName: String(raw.productName || raw.name || ""),
          missingSizes: asList(raw.missingSizes).map((item) =>
            typeof item === "object" ? String(item.size || "") : String(item)
          ).filter(Boolean),
          ownRrp: raw.ownRrp ?? null,
          supplierRrp: raw.supplierRrp ?? null,
          ownPrice: raw.ownPrice ?? null,
          supplierPrice: raw.supplierPrice ?? null,
          supplierPurchaseBase: raw.supplierPurchaseBase ?? null,
          supplierPurchasePrice: raw.supplierPurchasePrice ?? null,
          supplierDiscountPercentage: raw.supplierDiscountPercentage ?? null,
          notOrderable: asBoolean(raw.notOrderable),
          messages: asList(raw.messages).map(String)
        };

        if (!result.notOrderable) {
          result.notOrderable = result.messages.some((message) =>
            /niet bestelbaar|geen bestelbare|geen maattabel/i.test(message)
          );
        }

        if (result.missingSizes.length) {
          result.messages.push(`Ontbrekende maten: ${result.missingSizes.join(", ")}`);
        }
        result.messages = [...new Set(result.messages)];
        const ownDiscount = discountValue(result.ownPrice, result.ownRrp);
        const remoteDiscount = asNumber(result.supplierDiscountPercentage);
        result.priceIssue = !result.notOrderable && (
          differs(result.ownRrp, result.supplierRrp) || (
            ownDiscount !== null &&
            remoteDiscount !== null &&
            ownDiscount !== remoteDiscount
          )
        );
        return result;
      }

      function setStatus(message, kind = "") {
        state.message = message;
        els.status.className = `status ${kind}`.trim();
        els.statusText.textContent = message;
      }

      function updateStartButton() {
        const icon = els.start.querySelector("i");
        els.start.disabled = !state.running && !state.inventoryReady;
        els.start.classList.toggle("is-paused", state.running && state.paused);
        els.start.classList.toggle("is-running", state.running && !state.paused);
        if (!icon) return;
        if (!state.running) {
          icon.className = "fa-solid fa-play";
          els.start.title = "Start controle";
          els.start.setAttribute("aria-label", "Start controle");
        } else if (state.paused) {
          icon.className = "fa-solid fa-play";
          els.start.title = "Controle hervatten";
          els.start.setAttribute("aria-label", "Controle hervatten");
        } else {
          icon.className = "fa-solid fa-pause";
          els.start.title = "Controle pauzeren";
          els.start.setAttribute("aria-label", "Controle pauzeren");
        }
      }

      function selectedDownloadBrand() {
        const option = els.downloadBrand.selectedOptions?.[0];
        return {
          key: option?.value || "",
          brand: option?.dataset.brand || "",
          label: option?.dataset.label || option?.text || "",
          tagId: option?.dataset.tagId || ""
        };
      }

      function findDownloadBrandByName(brand) {
        const wanted = String(brand || "").trim();
        if (!wanted) return null;
        return [...els.downloadBrand.options].find((option) =>
          String(option.dataset.label || option.text || "").trim() === wanted ||
          String(option.dataset.brand || "").trim() === wanted ||
          String(option.value || "").trim() === wanted
        ) || null;
      }

      function selectDownloadBrand(brand) {
        const option = findDownloadBrandByName(brand);
        if (!option) return selectedDownloadBrand();
        els.downloadBrand.value = option.value;
        return selectedDownloadBrand();
      }

      function inferSingleBrand(items) {
        const brands = [...new Set(asList(items)
          .map((item) => String(item?.brand || "").trim())
          .filter(Boolean))];
        return brands.length === 1 ? brands[0] : "";
      }

      function sessionBrandContext(payload) {
        const fromSessionLabel = payload?.selectedBrand?.label || "";
        const fromSessionBrand = payload?.selectedBrand?.brand || payload?.brand || "";
        const fromPayload = fromSessionLabel ||
          inferSingleBrand(payload?.inventory) ||
          inferSingleBrand(payload?.results) ||
          fromSessionBrand;
        if (fromPayload) return selectDownloadBrand(fromPayload);
        return selectedDownloadBrand();
      }

      function withSessionBrand(item, brand) {
        return {
          ...(item || {}),
          brand: String(item?.brand || brand || "")
        };
      }

      function currentSessionBrandContext() {
        const selected = selectedDownloadBrand();
        if (selected.brand) return selected;
        const inferred = inferSingleBrand(state.inventory) || inferSingleBrand(state.results);
        const option = findDownloadBrandByName(inferred);
        if (!option) return selected;
        return {
          key: option.value || "",
          brand: option.dataset.brand || "",
          label: option.dataset.label || option.text || "",
          tagId: option.dataset.tagId || ""
        };
      }

      function supplierUrlFor(result) {
        if (result.supplierUrl) return result.supplierUrl;
        if (result.brand === "Chantelle" && result.productId) {
          return `https://chantelle-lingerie.my.site.com/DefaultStore/ccrz__ProductDetails?sku=${encodeURIComponent(result.productId)}`;
        }
        if (result.brand === "Anita" && result.productId) {
          const parsed = parseAnitaPid(result.productId);
          return `https://b2b.anita.com/nl/shop/441/?fssc=N&vsas=&koll=${encodeURIComponent(parsed.koll || "")}&form=&vacp=&arnr=${encodeURIComponent(parsed.arnr || "")}&vakn=&sicht=V&fbnr=${encodeURIComponent(parsed.fbnr || "")}`;
        }
        return "";
      }

      function parseAnitaPid(raw = "") {
        const pid = String(raw).trim().replace(/\s+/g, "");
        let match = pid.match(/^([A-Za-z0-9]{2})[- ]?(\d{4}[A-Za-z]?(?:-\d+)?)-(\d{3})$/);
        if (match) return { koll: match[1].toUpperCase(), arnr: match[2], fbnr: match[3] };
        match = pid.match(/^(\d{4}[A-Za-z]?(?:-\d+)?)-(\d{3})$/);
        if (match) return { koll: "", arnr: match[1], fbnr: match[2] };
        match = pid.match(/^(\d{4}[A-Za-z]?(?:-\d+)?)$/);
        if (match) return { koll: "", arnr: match[1], fbnr: "" };
        const parts = pid.split("-").filter(Boolean);
        if (parts.length >= 3) {
          const hasCollection = /[A-Za-z]/.test(parts[0]);
          return {
            koll: hasCollection ? parts[0].toUpperCase() : "",
            arnr: parts.slice(hasCollection ? 1 : 0, -1).join("-"),
            fbnr: parts[parts.length - 1] || ""
          };
        }
        if (parts.length === 2) return { koll: "", arnr: parts[0], fbnr: parts[1] };
        return { koll: "", arnr: pid, fbnr: "" };
      }

      function visibleResults() {
        return state.results.filter((result) => {
          if (els.brandFilter.value && result.brand !== els.brandFilter.value) return false;
          if (els.filter.value === "sizes") return result.missingSizes.length > 0;
          if (els.filter.value === "prices") return result.priceIssue;
          if (els.filter.value === "issues") return warningLabels(result).length > 0;
          if (els.filter.value.startsWith("warning:")) {
            return warningLabels(result).includes(els.filter.value.slice("warning:".length));
          }
          return true;
        });
      }

      function pills(values, className) {
        if (!values.length) return '<span class="muted">-</span>';
        return values.map((value) =>
          `<span class="pill ${className}">${escapeHtml(value)}</span>`
        ).join("");
      }

      function missingSizesCell(values) {
        if (!values.length) return "";
        return `<button class="sizes-toggle" type="button" aria-expanded="false">${values.length} ${values.length === 1 ? "maat" : "maten"}</button>`;
      }

      async function copyText(text) {
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(text);
            return;
          } catch {}
        }
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Kopieren naar klembord wordt niet toegestaan.");
      }

      function warningLabels(result) {
        const labels = [];
        if (result.notOrderable) {
          labels.push("Niet bestelbaar");
          if (result.messages.some((message) => message.includes("overgeslagen"))) labels.push("Overgeslagen");
          return [...new Set(labels)];
        }
        if (result.missingSizes.length) labels.push("Ontbrekende maten");
        if (differs(result.ownRrp, result.supplierRrp)) labels.push("Adviesprijs wijkt af");
        const ownDiscount = discountValue(result.ownPrice, result.ownRrp);
        const remoteDiscount = asNumber(result.supplierDiscountPercentage);
        if (ownDiscount !== null && remoteDiscount !== null && ownDiscount > remoteDiscount) {
          labels.push("DDO meer korting");
        }
        if (ownDiscount === 0 && remoteDiscount > 0) labels.push("Korting leverancier gemist");
        else if (ownDiscount > 0 && remoteDiscount > ownDiscount) labels.push("Leverancier meer korting");
        if (result.messages.some((message) => message.includes("overgeslagen"))) labels.push("Overgeslagen");
        return [...new Set(labels)];
      }

      function warningPills(result) {
        const softLabels = new Set(["Leverancier meer korting"]);
        return warningLabels(result).map((label) =>
          `<span class="pill ${softLabels.has(label) ? "warn" : "bad"}">${escapeHtml(label)}</span>`
        ).join("");
      }

      function render() {
        const brands = [...new Set(state.results.map((result) => result.brand).filter(Boolean))].sort();
        const selectedBrand = els.brandFilter.value;
        els.brandFilter.innerHTML = '<option value="">Alle merken</option>' + brands.map((brand) =>
          `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`
        ).join("");
        if (brands.includes(selectedBrand)) els.brandFilter.value = selectedBrand;

        const rows = visibleResults();
        els.results.innerHTML = rows.map((result) => {
          const detailId = `sizes-${encodeURIComponent(result.productId || result.warehouseId || result.productName)}`;
          return `
          <tr class="product-row" data-sizes-detail="${escapeHtml(detailId)}">
            <td>${link(
              `https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=${encodeURIComponent(result.warehouseId)}`,
              result.warehouseId
            )}</td>
            <td class="supplier-cell">${link(
              supplierUrlFor(result),
              result.productId
            )}${statusIcon(result.checkStatus, result.productId)}</td>
            <td>${escapeHtml(result.productName)}</td>
            <td class="sizes-cell">${missingSizesCell(result.missingSizes)}</td>
            <td>${money(result.ownRrp)}</td>
            <td>${money(result.ownPrice)}</td>
            <td>${discountValue(result.ownPrice, result.ownRrp) === null ? "" : `${discountValue(result.ownPrice, result.ownRrp)}%`}</td>
            <td>${money(result.supplierRrp)}</td>
            <td>${percentage(result.supplierDiscountPercentage)}</td>
            <td>${warningPills(result)}</td>
          </tr>
          ${result.missingSizes.length ? `
            <tr id="${escapeHtml(detailId)}" class="sizes-detail-row" hidden>
              <td colspan="9">
                <button class="copy-sizes" type="button" data-sizes="${escapeHtml(result.missingSizes.join("\n"))}">Kopieer maten</button>
                ${pills(result.missingSizes, "warn")}
              </td>
            </tr>
          ` : ""}
        `;
        }).join("");
        const visibleColumnCount = document.querySelectorAll("colgroup col").length;
        els.results.querySelectorAll(".sizes-detail-row td").forEach((cell) => {
          cell.colSpan = visibleColumnCount;
        });

        const issueResults = state.results.filter((result) => warningLabels(result).length);
        els.empty.hidden = rows.length > 0;
        els.empty.textContent = state.results.length
          ? "Geen resultaten voor het gekozen filter."
          : "Start de controle om resultaten te laden.";
        const countWarning = (label) => state.results.filter((result) => warningLabels(result).includes(label)).length;
        els.countProducts.textContent = String(state.results.length);
        els.countIssues.textContent = String(issueResults.length);
        els.countSizes.textContent = String(countWarning(WARNING_LABELS.sizes));
        els.countAdvice.textContent = String(countWarning(WARNING_LABELS.advice));
        els.countDdoDiscount.textContent = String(countWarning(WARNING_LABELS.ddoDiscount));
        els.countMissedDiscount.textContent = String(countWarning(WARNING_LABELS.missedDiscount));
        els.countSupplierDiscount.textContent = String(countWarning(WARNING_LABELS.supplierDiscount));
        els.countNotOrderable.textContent = String(countWarning(WARNING_LABELS.notOrderable));
        els.countSkipped.textContent = String(countWarning(WARNING_LABELS.skipped));
      }

      function start() {
        if (state.running) return;
        if (!state.adapters.size && new URLSearchParams(location.search).get("demo") !== "1") {
          setStatus("Geen watcher-adapter geladen op deze pagina. Installeer het watcher-userscript en ververs brands.html.", "error");
          return;
        }
        state.runId = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        state.running = true;
        state.paused = false;
        updateStartButton();
        setStatus("Controle gestart...", "running");
        render();
        window.dispatchEvent(new CustomEvent("brands-watcher:start", {
          detail: { runId: state.runId, resume: true, ...selectedDownloadBrand() }
        }));
      }

      function startOrTogglePause() {
        if (state.running) togglePause();
        else start();
      }

      function clear() {
        state.results = [];
        render();
        setStatus("Resultaten gewist.");
      }

      function togglePause() {
        if (!state.running) return;
        state.paused = !state.paused;
        updateStartButton();
        setStatus(state.paused ? "Controle gepauzeerd." : "Controle hervat.", state.paused ? "" : "running");
        window.dispatchEvent(new CustomEvent("brands-watcher:pause", {
          detail: { paused: state.paused }
        }));
      }

      function loadDdoExport() {
        if (!state.adapters.size && new URLSearchParams(location.search).get("demo") !== "1") {
          setStatus("Automatisch ophalen vereist het watcher-userscript. Gebruik anders 'Importeer DDO-bestand'.", "error");
          return;
        }
        const selected = selectedDownloadBrand();
        if (!selected.brand || !selected.tagId) {
          setStatus("Kies eerst een merk voor de DDO-download.", "error");
          return;
        }
        setStatus(`DDO-export ophalen: ${selected.label || selected.brand}...`, "running");
        window.dispatchEvent(new CustomEvent("brands-watcher:load-ddo", { detail: selected }));
      }

      function chooseDdoFile() {
        els.ddoFile.click();
      }

      function normalizeHeader(header) {
        return String(header ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
      }

      function firstValue(row, aliases) {
        for (const alias of aliases) {
          const value = row[normalizeHeader(alias)];
          if (value !== undefined && value !== null && String(value).trim() !== "") return value;
        }
        return "";
      }

      function parseDdoFile(buffer) {
        if (!window.XLSX) throw new Error("Excel-parser kon niet worden geladen. Controleer je internetverbinding.");
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const groups = new Map();
        const selected = selectedDownloadBrand();
        const aliases = {
          sku: ["product id", "product_id", "supplier_pid", "supplier pid", "supplier sku", "leveranciersartikelnummer", "leverancier artikelnummer", "sku", "model"],
          id: ["product_id", "product id", "id"],
          name: ["model", "product_name", "product name", "name", "naam", "title"],
          size: ["size", "maat", "option", "option name", "attribute", "attribute value", "value"],
          ownPrice: ["price", "prijs", "selling price", "verkoopprijs"],
          ownRrp: ["advice price", "rrp", "adviesprijs", "recommended retail price", "old price", "price old"]
        };

        for (const sourceRow of sourceRows) {
          const row = {};
          for (const [key, value] of Object.entries(sourceRow || {})) row[normalizeHeader(key)] = value;
          const sku = String(firstValue(row, aliases.sku)).trim();
          if (!sku) continue;
          const productId = String(firstValue(row, aliases.id)).trim();
          const warehouseId = String(row.productid1 || "").match(/\d{5}/)?.[0] || "";
          const key = productId || sku;
          if (!groups.has(key)) {
            groups.set(key, {
              brand: selected.label || selected.brand || "Onbekend",
              productId,
              warehouseId,
              productName: String(firstValue(row, aliases.name)).trim(),
              sku,
              sizes: [],
              ownPrice: firstValue(row, aliases.ownPrice),
              ownRrp: firstValue(row, aliases.ownRrp)
            });
          }
          const size = String(firstValue(row, aliases.size)).trim();
          if (size && !groups.get(key).sizes.includes(size)) groups.get(key).sizes.push(size);
        }

        if (!groups.size) {
          const headers = Object.keys(sourceRows[0] || {}).join(", ");
          throw new Error(`Geen producten herkend. Gevonden kolommen: ${headers || "geen"}`);
        }
        return [...groups.values()];
      }

      async function importDdoFile() {
        const file = els.ddoFile.files?.[0];
        if (!file) return;
        try {
          const selected = selectedDownloadBrand();
          if (!selected.brand) throw new Error("Kies eerst een merk voor deze import.");
          setStatus(`DDO-bestand importeren: ${file.name} | ${selected.label || selected.brand}...`, "running");
          const products = parseDdoFile(await file.arrayBuffer());
          state.inventory = products;
          window.BrandsWatcher.setInventory(products, `DDO-bestand ingelezen: ${file.name} | ${products.length} producten.`);
          window.dispatchEvent(new CustomEvent("brands-watcher:inventory-loaded", {
            detail: { products, fileName: file.name, ...selectedDownloadBrand() }
          }));
        } catch (error) {
          window.BrandsWatcher.fail(String(error?.message || error));
        } finally {
          els.ddoFile.value = "";
        }
      }

      function csvCell(value) {
        return `"${String(value ?? "").replace(/"/g, '""')}"`;
      }

      function downloadBlob(content, mimeType, filename) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
      }

      function saveSession() {
        const selectedBrand = currentSessionBrandContext();
        const payload = {
          version: 2,
          savedAt: new Date().toISOString(),
          selectedBrand,
          inventory: state.inventory,
          results: state.results
        };
        downloadBlob(
          JSON.stringify(payload, null, 2),
          "application/json;charset=utf-8",
          `brands-watcher-sessie-${new Date().toISOString().slice(0, 10)}.json`
        );
        setStatus(`Sessie bewaard: ${state.results.length} resultaten.`, "success");
      }

      function chooseSessionFile() {
        els.sessionFile.click();
      }

      async function importSession() {
        const file = els.sessionFile.files?.[0];
        if (!file) return;
        try {
          const payload = JSON.parse(await file.text());
          if (!Array.isArray(payload.results)) throw new Error("Dit bestand bevat geen geldige watcher-resultaten.");
          const selected = sessionBrandContext(payload);
          const sessionBrand = selected.label || selected.brand;
          const restoredResults = payload.results
            .map((result) => normalizeResult(withSessionBrand(result, sessionBrand)));
          const resultByProductId = new Map(restoredResults.map((result) => [result.productId, result]));
          state.inventory = (asList(payload.inventory).length ? asList(payload.inventory) : restoredResults)
            .map((product) => ({
              ...withSessionBrand(product, sessionBrand),
              ...(resultByProductId.get(String(product?.productId || product?.id || "")) || {})
            }));
          state.results = state.inventory.map((result) => normalizeResult(result || {}));
          state.inventoryCount = state.inventory.length || state.results.length;
          state.inventoryReady = state.inventoryCount > 0;
          els.filter.value = "all";
          updateStartButton();
          render();
          setStatus(`Sessie ingelezen: ${state.results.length} resultaten${sessionBrand ? ` | ${sessionBrand}` : ""}.`, "success");
          window.dispatchEvent(new CustomEvent("brands-watcher:inventory-loaded", {
            detail: { products: state.inventory, restored: true, ...selected }
          }));
        } catch (error) {
          window.BrandsWatcher.fail(String(error?.message || error));
        } finally {
          els.sessionFile.value = "";
        }
      }

      function downloadCsv() {
        const header = [
          "Magazijn-ID", "Supplier ID", "Product", "Ontbrekende maten", "A.prijs DDO",
          "Prijs DDO", "Korting DDO", "A.prijs remote", "% remote", "Waarschuwingen"
        ];
        const rows = state.results.map((result) => [
          result.warehouseId, result.productId, result.productName, result.missingSizes.join(", "),
          result.ownRrp, result.ownPrice, discountPercentage(result.ownPrice, result.ownRrp),
          result.supplierRrp,
          percentage(result.supplierDiscountPercentage),
          warningLabels(result).join(" | ")
        ]);
        const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
        downloadBlob("\ufeff" + csv, "text/csv;charset=utf-8", "brands-watcher-resultaten.csv");
      }

      window.BrandsWatcher = {
        registerAdapter(name) {
          const adapter = String(name || "").trim();
          if (!adapter) return;
          state.adapters.add(adapter);
          setStatus(`Adapter geladen: ${[...state.adapters].join(", ")}.`);
        },
        inventoryLoaded(count, message) {
          state.inventoryCount = Number(count) || 0;
          state.inventoryReady = state.inventoryCount > 0;
          updateStartButton();
          setStatus(String(message || `DDO-tabel ingelezen: ${state.inventoryCount} producten.`), "success");
          render();
        },
        setInventory(products, message) {
          state.inventory = asList(products);
          state.results = state.inventory.map((product) => normalizeResult(product || {}));
          state.inventoryCount = state.inventory.length;
          state.inventoryReady = state.inventoryCount > 0;
          els.filter.value = "all";
          updateStartButton();
          setStatus(String(message || `DDO-tabel ingelezen: ${state.inventoryCount} producten.`), "success");
          render();
        },
        addResult(raw) {
          const existing = state.results.find((item) =>
            item.productId && raw?.productId && item.productId === String(raw.productId)
          );
          const result = normalizeResult({ ...existing, ...(raw || {}) });
          const index = state.results.findIndex((item) =>
            item.productId && result.productId && item.productId === result.productId
          );
          if (index >= 0) state.results.splice(index, 1, result);
          else state.results.push(result);
          render();
        },
        addResults(results) {
          asList(results).forEach((result) => this.addResult(result));
        },
        progress(message) {
          setStatus(String(message || "Bezig met controleren..."), "running");
        },
        complete(message) {
          state.running = false;
          state.paused = false;
          updateStartButton();
          setStatus(String(message || `Controle afgerond: ${state.results.length} producten.`), "success");
          render();
        },
        fail(message) {
          state.running = false;
          state.paused = false;
          updateStartButton();
          setStatus(String(message || "De controle is gestopt door een fout."), "error");
        }
      };

      if (new URLSearchParams(location.search).get("demo") === "1") {
        const demoInventory = [
          {
            brand: "Chantelle",
            productId: "DEMO-1001",
            supplierUrl: "https://example.com/products/DEMO-1001",
            warehouseId: "12345",
            productName: "Demo bh",
            ownRrp: 69.95,
            ownPrice: 69.95
          },
          {
            brand: "Chantelle",
            productId: "DEMO-1002",
            supplierUrl: "https://example.com/products/DEMO-1002",
            warehouseId: "67890",
            productName: "Demo slip",
            ownRrp: 34.95,
            ownPrice: 24.95
          },
          {
            brand: "Chantelle",
            productId: "DEMO-1003",
            supplierUrl: "https://example.com/products/DEMO-1003",
            warehouseId: "24680",
            productName: "Demo top",
            ownRrp: 100,
            ownPrice: 80
          }
        ];
        window.BrandsWatcher.registerAdapter("Chantelle demo");
        window.addEventListener("brands-watcher:load-ddo", (event) => {
          const brand = event.detail?.brand || "Chantelle";
          const products = demoInventory.map((product) => ({ ...product, brand }));
          setTimeout(() => window.BrandsWatcher.setInventory(products, `Demo DDO-tabel ingelezen: ${products.length} ${brand}-producten.`), 150);
        });
        window.addEventListener("brands-watcher:import-ddo", () => {
          setTimeout(() => window.BrandsWatcher.setInventory(demoInventory, "Demo DDO-bestand ingelezen: 3 producten."), 150);
        });
        window.addEventListener("brands-watcher:start", () => {
          window.BrandsWatcher.progress("Demo uitvoeren...");
          setTimeout(() => {
            window.BrandsWatcher.addResults([
              {
                brand: "Chantelle",
                productId: "DEMO-1001",
                productName: "Demo bh",
                checkStatus: "checked",
                missingSizes: ["75D", "80E"],
                ownRrp: 69.95,
                supplierRrp: 100,
                ownPrice: 69.95,
                supplierPurchaseBase: 48.67,
                supplierPurchasePrice: 29.20,
                supplierDiscountPercentage: 20
              },
              {
                brand: "Chantelle",
                productId: "DEMO-1002",
                productName: "Demo slip",
                checkStatus: "skipped",
                messages: ["Chantelle overgeslagen: geen bruikbare stockmaten"],
                missingSizes: [],
                ownRrp: 34.95,
                supplierRrp: 39.95,
                ownPrice: 24.95,
                supplierPurchaseBase: 18.50,
                supplierPurchasePrice: 18.50,
                supplierDiscountPercentage: 0
              },
              {
                brand: "Chantelle",
                productId: "DEMO-1003",
                productName: "Demo top",
                checkStatus: "checked",
                missingSizes: [],
                ownRrp: 100,
                supplierRrp: 100,
                ownPrice: 80,
                supplierDiscountPercentage: 30
              }
            ]);
            window.BrandsWatcher.complete("Controle afgerond: 2 verwerkt, 1 overgeslagen.");
          }, 250);
        });
        window.addEventListener("brands-watcher:retry", (event) => {
          if (event.detail?.productId !== "DEMO-1002") return;
          window.BrandsWatcher.progress("Demo-item opnieuw controleren...");
          setTimeout(() => {
            window.BrandsWatcher.addResult({
              ...demoInventory[1],
              checkStatus: "checked",
              messages: [],
              supplierDiscountPercentage: 0
            });
            window.BrandsWatcher.complete("Product opnieuw gecontroleerd.");
          }, 250);
        });
      }

      els.start.addEventListener("click", startOrTogglePause);
      els.saveSession.addEventListener("click", saveSession);
      els.importSession.addEventListener("click", chooseSessionFile);
      els.sessionFile.addEventListener("change", importSession);
      els.loadDdo.addEventListener("click", loadDdoExport);
      els.importDdo.addEventListener("click", chooseDdoFile);
      els.ddoFile.addEventListener("change", importDdoFile);
      els.clear.addEventListener("click", clear);
      els.csv.addEventListener("click", downloadCsv);
      els.filter.addEventListener("change", render);
      els.brandFilter.addEventListener("change", render);
      els.results.addEventListener("click", (event) => {
        const retryButton = event.target.closest(".retry-check");
        if (retryButton) {
          retryButton.disabled = true;
          window.dispatchEvent(new CustomEvent("brands-watcher:retry", {
            detail: { productId: retryButton.dataset.productId }
          }));
          return;
        }
        const copyButton = event.target.closest(".copy-sizes");
        if (copyButton) {
          const originalText = copyButton.textContent;
          copyText(copyButton.dataset.sizes || "")
            .then(() => { copyButton.textContent = "Gekopieerd"; })
            .catch(() => { copyButton.textContent = "Kopieren mislukt"; })
            .finally(() => setTimeout(() => { copyButton.textContent = originalText; }, 1800));
          return;
        }
        const toggle = event.target.closest(".sizes-toggle");
        if (!toggle) return;
        const row = toggle.closest("tr");
        const detailRow = document.getElementById(row?.dataset?.sizesDetail || "");
        if (!detailRow) return;
        const open = detailRow.hidden;
        detailRow.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
      });
      render();
    })();

