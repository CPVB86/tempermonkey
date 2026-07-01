// ==UserScript==
// @name         DDO | Paste2Order CMS Status Worker
// @namespace    https://dutchdesignersoutlet.com/
// @version      0.1
// @description  Zet geselecteerde Paste2Order orders in het DDO CMS op een nieuwe status met optionele notificatie.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/hosted/2order/p2o-status-worker.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/hosted/2order/p2o-status-worker.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STATUS_ID = "paste2order-cms-status-worker";

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getRequest() {
    const hash = decodeURIComponent(location.hash || "").replace(/^#/, "");
    if (!hash) return null;

    const params = new URLSearchParams(hash);
    const status = (params.get("paste2order-cms-status") || "").trim();
    const orders = (params.get("orders") || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);

    if (!status || !orders.length) return null;

    return {
      status,
      orders,
      label: (params.get("label") || `status ${status}`).trim(),
      notify: params.get("notify") === "1",
      sourceStatusId: (params.get("sourceStatusId") || "3").trim()
    };
  }

  function setStatus(message, state = "info") {
    let status = document.getElementById(STATUS_ID);

    if (!status) {
      status = document.createElement("div");
      status.id = STATUS_ID;
      status.style.cssText = [
        "position:fixed",
        "right:14px",
        "bottom:14px",
        "z-index:999999",
        "max-width:420px",
        "padding:9px 11px",
        "border-radius:6px",
        "font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif",
        "box-shadow:0 8px 24px rgba(0,0,0,.2)",
        "background:#fff",
        "color:#1f2933",
        "border:1px solid #d1d5db",
        "white-space:pre-wrap"
      ].join(";");
      document.body.appendChild(status);
    }

    status.textContent = message;
    status.style.borderColor = state === "error" ? "#dc2626" : state === "ok" ? "#16a34a" : "#d1d5db";
  }

  function clearHash() {
    history.replaceState(null, document.title, location.pathname + location.search);
  }

  function getStatusForm() {
    return document.querySelector('form[action*="section=orders"][action*="viewstatus"]') ||
      document.querySelector('form.ajax_form');
  }

  function buildPayload(request) {
    const body = new URLSearchParams();

    request.orders.forEach(orderId => body.append("orders[]", orderId));
    body.set("status", request.status);
    if (request.notify) body.set("mail", "1");
    body.set("updatemulti", "Update status");
    body.set("redirect", `/admin.php?section=orders&action=viewstatus&id=${encodeURIComponent(request.sourceStatusId || "3")}`);

    return body;
  }

  async function postStatusUpdate(request) {
    const form = getStatusForm();
    const action = form?.getAttribute("action") || `/admin.php?section=orders&action=viewstatus&id=${encodeURIComponent(request.sourceStatusId || "3")}`;
    const url = new URL(action, location.origin).href;
    const body = buildPayload(request);

    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Accept": "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: body.toString()
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`CMS statusupdate mislukt (${response.status}): ${text.slice(0, 180)}`);
    }

    return text;
  }

  async function closeWorkerTabAfterSuccess() {
    await wait(700);
    window.close();
    setStatus("Paste2Order: klaar. Dit CMS-tabblad mag dicht.", "ok");
  }

  async function run(request) {
    const notifyText = request.notify ? "met notificatie" : "zonder notificatie";

    setStatus(`Paste2Order: ${request.orders.length} CMS order(s) naar ${request.label} zetten ${notifyText}...`);

    const responseText = await postStatusUpdate(request);
    console.log("[Paste2Order CMS status worker]", {
      orders: request.orders,
      status: request.status,
      label: request.label,
      notify: request.notify,
      response: responseText
    });

    clearHash();
    setStatus(`Paste2Order: ${request.orders.length} CMS order(s) bijgewerkt naar ${request.label}. Tabblad sluit zo.`, "ok");
    await closeWorkerTabAfterSuccess();
  }

  const request = getRequest();
  if (!request) return;

  run(request).catch(err => {
    console.error("[Paste2Order CMS status worker]", err);
    setStatus(`Paste2Order: CMS statusupdate mislukt.\n${err?.message || err}`, "error");
  });
})();
