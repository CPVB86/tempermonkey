// ==UserScript==
// @name         GG | ScanSim Pro
// @version      2.7
// @description  Scan Simulator; leest barcodes uit klembord. Incoming: batch + preset. Anti-double: single-instance + clipboard dedupe + NETWORK dedupe ONLY for commit/register (prevents double booking, allows repeated scans).
// @match        https://fm-e-warehousing.goedgepickt.nl/products/incoming*
// @match        https://fm-e-warehousing.goedgepickt.nl/products/outgoing-products
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/scansim.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/scansim.user.js
// ==/UserScript==

(function () {
  'use strict';

  const path = location.pathname;
  const isIncoming = path === '/products/incoming';
  const isOutgoing = path === '/products/outgoing-products';
  if (!isIncoming && !isOutgoing) return;

  // =========================
  // Single-instance guard
  // =========================
  if (window.__scansimInstanceActive) return;
  window.__scansimInstanceActive = true;
  window.addEventListener('beforeunload', () => {
    try { delete window.__scansimInstanceActive; } catch (_) {}
  });

  // =========================
  // Settings
  // =========================
  const NEUTRALIZE_SCROLL_ANIMATE = true;

  const INCOMING_FAST_BULK = true;
  const FREEZE_RENDER = true;
  const NO_CHUNK_YIELD = true;
  const CHUNK_SIZE = 200;
  const YIELD_MS = 0;

  const PROCESS_DEBOUNCE_MS = 250;

  const BUFFER_INCOMING = false;
  const FLUSH_INTERVAL_MS = 50;
  const BATCH_SIZE = 50;

  const SCANSIM_BATCH = {
    enabled: true,
    batchSize: 50,
    storageKey: 'scansim_incoming_batch_v1'
  };

  const FREEZE_TARGET_SELECTORS = [
    '.scanned_tasks_body',
    '#scanned_tasks_body',
    '.scanned_tasks',
    '#scanned_tasks',
    '.tasks',
    '#tasks',
    '.task-list',
    '.tasklist',
    '.table-responsive',
    'table',
    '.content',
    '#content',
    'main'
  ];
  const FREEZE_OVERRIDE_SELECTOR = null;

  // =========================
  // Global anti-double processing guard (UI triggers)
  // =========================
  let __scansimProcessing = false;
  let __lastClipboardSig = '';
  let __lastClipboardAt = 0;

  function makeClipboardSig(text) {
    const t = (text || '').trim();
    return `${location.pathname}|${t.length}|${t.slice(0, 80)}|${t.slice(-80)}`;
  }

  async function withGlobalProcessGuard({ clipboardText = null, sameClipboardWindowMs = 1500 } = {}, fn) {
    const now = Date.now();
    if (__scansimProcessing) return;

    if (typeof clipboardText === 'string') {
      const sig = makeClipboardSig(clipboardText);
      if (sig === __lastClipboardSig && (now - __lastClipboardAt) < sameClipboardWindowMs) return;
      __lastClipboardSig = sig;
      __lastClipboardAt = now;
    }

    __scansimProcessing = true;
    try { await fn(); } finally { __scansimProcessing = false; }
  }

  // =========================
  // HARD FIX: Network dedupe (ONLY for commit/register)
  // =========================
  const NET_DEDUPE_WINDOW_MS = 15000;
  const netRecent = new Map(); // sig -> ts

  function pruneNetRecent(now) {
    for (const [k, ts] of netRecent) {
      if (now - ts > NET_DEDUPE_WINDOW_MS) netRecent.delete(k);
    }
  }

  function normalizeUrl(url) {
    try {
      const u = new URL(url, location.origin);
      return u.pathname + (u.search || '');
    } catch {
      return String(url || '');
    }
  }

  function looksLikeScanAdd(url, body) {
    // These requests are allowed to repeat many times (ean x 5 should be 5 POSTs)
    const u = (url || '').toLowerCase();
    const b = (body || '').toLowerCase();

    // common patterns for "add a scanned barcode"
    const bodyHasBarcode = /\b(ean|barcode|bar_code|code|scan|scanned)\b\s*=/.test(b);
    const urlHasScan = /(scan|scanned|barcode|ean|task)/.test(u);

    // BUT: commit/register often also contains "scanned" words — we filter those in commit check below.
    return bodyHasBarcode || urlHasScan;
  }

  function looksLikeCommitRegister(url, body) {
    const u = (url || '').toLowerCase();
    const b = (body || '').toLowerCase();

    // Strong hints for "Ontvangst registreren" action
    return (
      u.includes('attach_scanned') ||
      u.includes('attach') ||
      u.includes('register') ||
      u.includes('incoming/attach') ||
      b.includes('attach_scanned_products') ||
      b.includes('attach_scanned') ||
      b.includes('ontvangst') ||
      b.includes('register')
    );
  }

  function shouldDedupeRequest(method, url, bodyText) {
    const m = String(method || 'GET').toUpperCase();
    if (m !== 'POST') return false;

    const u = normalizeUrl(url);
    const body = (bodyText || '').trim();
    if (!body) return false;

    // ✅ Only dedupe the commit/register action.
    // 🚫 Never dedupe the per-scan "add barcode" calls.
    const isCommit = looksLikeCommitRegister(u, body);
    if (!isCommit) return false;

    // If it ALSO looks like a scan add, do NOT dedupe (safety net)
    if (looksLikeScanAdd(u, body)) return false;

    const sig = `${m}|${u}|${body.slice(0, 4000)}`; // cap
    const now = Date.now();
    pruneNetRecent(now);

    const prev = netRecent.get(sig);
    if (prev && (now - prev) < NET_DEDUPE_WINDOW_MS) {
      console.warn('[ScanSim] BLOCKED duplicate COMMIT/REGISTER POST:', u);
      return true;
    }

    netRecent.set(sig, now);
    return false;
  }

  function installFetchDedupe() {
    if (window.__scansimFetchDedupeInstalled) return;
    window.__scansimFetchDedupeInstalled = true;

    const origFetch = window.fetch;
    if (typeof origFetch !== 'function') return;

    window.fetch = async function (input, init = {}) {
      try {
        const url = (typeof input === 'string') ? input : (input?.url || '');
        const method = init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET';

        let bodyText = '';
        const b = init?.body;

        if (typeof b === 'string') bodyText = b;
        else if (b instanceof URLSearchParams) bodyText = b.toString();
        else if (b && typeof b === 'object' && !(b instanceof FormData)) {
          try { bodyText = JSON.stringify(b); } catch (_) {}
        }

        if (shouldDedupeRequest(method, url, bodyText)) {
          // fake "ok" response so app doesn't crash
          return new Response(JSON.stringify({ scansim: 'deduped_commit', ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (_) {}

      return origFetch.apply(this, arguments);
    };
  }

  function installXhrDedupe() {
    if (window.__scansimXhrDedupeInstalled) return;
    window.__scansimXhrDedupeInstalled = true;

    const XHR = window.XMLHttpRequest;
    if (!XHR) return;

    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__scansimMethod = method;
      this.__scansimUrl = url;
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      try {
        let bodyText = '';
        if (typeof body === 'string') bodyText = body;
        else if (body instanceof URLSearchParams) bodyText = body.toString();
        if (body instanceof FormData) bodyText = ''; // can't reliably dedupe

        if (bodyText && shouldDedupeRequest(this.__scansimMethod, this.__scansimUrl, bodyText)) {
          try { this.abort(); } catch (_) {}
          return;
        }
      } catch (_) {}

      return origSend.apply(this, arguments);
    };
  }

  // =========================
  // Internal keys for commit workflow
  // =========================
  const PENDING_KEY = SCANSIM_BATCH.storageKey + '_pending';

  function loadPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
  }
  function savePending(p) { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); }
  function clearPending() { localStorage.removeItem(PENDING_KEY); }

  // -------------------------
  // Neutralize jQuery scroll animations
  // -------------------------
  (function neutralizeBodyScrollAnimate() {
    if (!NEUTRALIZE_SCROLL_ANIMATE) return;
    const $ = window.jQuery;
    if (!$ || !$.fn || !$.fn.animate) return;

    const origAnimate = $.fn.animate;
    $.fn.animate = function (props, speed, easing, callback) {
      try {
        const isHtmlBody = this.is('html, body');
        const isScrollTop = props && Object.prototype.hasOwnProperty.call(props, 'scrollTop');
        if (isHtmlBody && isScrollTop) {
          this.stop(true, false);
          this.scrollTop(props.scrollTop);
          if (typeof easing === 'function') easing.call(this);
          if (typeof callback === 'function') callback.call(this);
          return this;
        }
      } catch (_) {}
      return origAnimate.apply(this, arguments);
    };
  })();

  // -------------------------
  // Font Awesome
  // -------------------------
  function injectFontAwesome() {
    if (document.querySelector('link[href*="font-awesome"], link[href*="fontawesome"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    document.head.appendChild(link);
  }

  // -------------------------
  // Helpers
  // -------------------------
  function waitFor(fn, { timeoutMs = 15000, intervalMs = 100 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        try {
          const res = fn();
          if (res) { clearInterval(t); resolve(res); return; }
          if (Date.now() - start > timeoutMs) { clearInterval(t); reject(new Error('timeout')); }
        } catch (e) { clearInterval(t); reject(e); }
      }, intervalMs);
    });
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isTabActive = () => document.visibilityState === 'visible' && document.hasFocus();

  // -------------------------
  // Focus guard (quiet)
  // -------------------------
  function wrapIncomingFunctionsToRequireFocus() {
    if (!isIncoming) return;
    const guard = () => isTabActive();

    if (typeof window.addBarcodeToTasks === 'function' && !window.addBarcodeToTasks.__scansimWrappedFocus) {
      const original = window.addBarcodeToTasks.bind(window);
      window.addBarcodeToTasks = function (...args) {
        if (!guard()) return;
        return original(...args);
      };
      window.addBarcodeToTasks.__scansimWrappedFocus = true;
    }

    if (typeof window.processScannedProducts === 'function' && !window.processScannedProducts.__scansimWrappedFocus) {
      const original = window.processScannedProducts.bind(window);
      window.processScannedProducts = function (...args) {
        if (!guard()) return;
        return original(...args);
      };
      window.processScannedProducts.__scansimWrappedFocus = true;
    }
  }

  // -------------------------
  // Stock Check preset button (incoming)
  // -------------------------
  function addStockCheckButton() {
    if (!isIncoming) return;
    if (document.getElementById('scansim-stockcheck-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'scansim-stockcheck-btn';
    btn.type = 'button';
    btn.title = 'Preset: Stock Check + locatie 00. Extern';
    btn.innerHTML = `<i class="fa-solid fa-boxes-stacked"></i>`;
    Object.assign(btn.style, {
      position: 'fixed', bottom: '20px', right: '80px', zIndex: 9999,
      padding: '10px 12px', fontSize: '16px',
      backgroundColor: '#343a40', color: '#fff',
      border: 'none', borderRadius: '6px',
      cursor: 'pointer', display: 'flex', alignItems: 'center',
      boxShadow: '0 6px 20px rgba(0,0,0,0.2)'
    });

    btn.addEventListener('mouseenter', () => (btn.style.backgroundColor = '#495057'));
    btn.addEventListener('mouseleave', () => (btn.style.backgroundColor = '#343a40'));

    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      await withGlobalProcessGuard({}, async () => {
        try { await applyStockCheckPreset(); } catch (err) {
          console.error('[ScanSim] Stock Check preset faalde', err);
          alert('Stock Check preset faalde. Open console voor details.');
        }
      });
    });

    document.body.appendChild(btn);
  }

  function setSelectValueAndTrigger(selectEl, value) {
    if (!selectEl) return;
    selectEl.value = value;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setInputValue(inputEl, value) {
    if (!inputEl) return;
    inputEl.value = value;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function click(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }
  function openFancyDropdown() {
    const root = document.querySelector('#picklocationSelect .fancy-input');
    if (!root) return false;
    return click(root.querySelector('.value-holder') || root);
  }

  async function applyStockCheckPreset() {
    const bulkReason = document.querySelector('#bulk_reason');
    const otherReason = document.querySelector('#other_reason');
    const inboundLocation = document.querySelector('#inbound_location');

    if (!bulkReason) throw new Error('#bulk_reason niet gevonden');
    if (!inboundLocation) throw new Error('#inbound_location niet gevonden');

    setSelectValueAndTrigger(bulkReason, 'other');
    if (otherReason) setInputValue(otherReason, 'Stock Check');

    setSelectValueAndTrigger(inboundLocation, 'otherLocation');

    await waitFor(() => {
      const wrap = document.querySelector('#picklocationSelect .dropdown-item-wrapper');
      const loading = document.querySelector('#picklocationSelect .loader-wrapper');
      const hasOptions = !!document.querySelector('#picklocationSelect .dropdown-item.option[data-key]');
      const isLoading = loading && loading.style && loading.style.display !== 'none';
      return wrap && hasOptions && !isLoading ? true : null;
    }, { timeoutMs: 20000, intervalMs: 150 });

    openFancyDropdown();

    const externItem = await waitFor(() => {
      return document.querySelector('#picklocationSelect .dropdown-item.option[data-key="00. Extern"]') || null;
    }, { timeoutMs: 20000, intervalMs: 150 });

    const externValue = externItem.getAttribute('data-value');
    click(externItem);

    const otherLocationSelect = document.querySelector('#otherLocation');
    if (otherLocationSelect && externValue) {
      otherLocationSelect.value = externValue;
      otherLocationSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const holder = document.querySelector('#picklocationSelect .value-holder');
    if (holder) holder.textContent = '00. Extern';
  }

  // -------------------------
  // Inject scan task
  // -------------------------
  function injectScanTask(barcode) {
    if (isIncoming) {
      if (typeof window.addBarcodeToTasks === 'function') window.addBarcodeToTasks(barcode);
      return;
    }

    const tbody = document.querySelector('.scanned_tasks_body');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.classList.add('to_do_task');

    const tdIcon = document.createElement('td');
    const tdBarcode = document.createElement('td');
    tdBarcode.classList.add('barcode_td');
    tdBarcode.dataset.barcode = barcode;
    tdBarcode.textContent = barcode;

    tr.appendChild(tdIcon);
    tr.appendChild(tdBarcode);
    tbody.prepend(tr);
  }

  // -------------------------
  // Incoming: processing kick (debounced)
  // -------------------------
  let incomingKickTimer = null;
  function scheduleIncomingProcessKick() {
    if (!isIncoming) return;
    if (!isTabActive()) return;

    if (incomingKickTimer) clearTimeout(incomingKickTimer);
    incomingKickTimer = setTimeout(() => {
      incomingKickTimer = null;
      if (typeof window.processScannedProducts === 'function') {
        try { window.processScannedProducts(); } catch (_) {}
      }
    }, PROCESS_DEBOUNCE_MS);
  }

  // -------------------------
  // Legacy buffering (optional)
  // -------------------------
  const scanQueue = [];
  let flushTimer = null;

  function enqueueScan(barcode, count = 1) {
    for (let i = 0; i < count; i++) scanQueue.push(barcode);
    scheduleFlush();
  }
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flushQueue, FLUSH_INTERVAL_MS);
  }
  function flushQueue() {
    flushTimer = null;
    if (!scanQueue.length) return;

    const batch = scanQueue.splice(0, BATCH_SIZE);
    for (const bc of batch) injectScanTask(bc);

    if (scanQueue.length) scheduleFlush();
    if (isIncoming) scheduleIncomingProcessKick();
  }

  // -------------------------
  // UI Freeze
  // -------------------------
  let freezeStyleEl = null;
  let frozenTargets = [];

  function getFreezeTargets() {
    const targets = [];
    const selectors = FREEZE_OVERRIDE_SELECTOR ? [FREEZE_OVERRIDE_SELECTOR] : FREEZE_TARGET_SELECTORS;

    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (!el || !el.style) return;
          if (targets.includes(el)) return;
          targets.push(el);
        });
      } catch (_) {}
    }

    return targets.filter(el => {
      const r = el.getBoundingClientRect?.();
      return r && r.width > 200 && r.height > 150;
    });
  }

  function freezeUI() {
    if (!FREEZE_RENDER) return;
    if (!freezeStyleEl) {
      freezeStyleEl = document.createElement('style');
      freezeStyleEl.id = 'scansim-freeze-style';
      freezeStyleEl.textContent = `.scansim-freeze * { transition:none !important; animation:none !important; caret-color:transparent !important; }`;
      document.head.appendChild(freezeStyleEl);
    }
    document.documentElement.classList.add('scansim-freeze');

    frozenTargets = getFreezeTargets();
    frozenTargets.forEach(el => {
      if (!el.__scansimPrevDisplay) el.__scansimPrevDisplay = el.style.display;
      el.style.display = 'none';
    });

    if (!document.body.__scansimPrevOverflow) document.body.__scansimPrevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  function unfreezeUI() {
    if (!FREEZE_RENDER) return;

    frozenTargets.forEach(el => {
      el.style.display = el.__scansimPrevDisplay || '';
      delete el.__scansimPrevDisplay;
    });
    frozenTargets = [];

    document.documentElement.classList.remove('scansim-freeze');
    document.body.style.overflow = document.body.__scansimPrevOverflow || '';
    delete document.body.__scansimPrevOverflow;
  }

  // -------------------------
  // Fast incoming bulk
  // -------------------------
  function parseClipboardLinesToExpanded(text) {
    const lines = (text || '').trim().split('\n');
    const expanded = [];
    for (const line of lines) {
      const [barcodeRaw, countRaw] = line.split('\t');
      const barcode = (barcodeRaw || '').trim();
      const count = Math.abs(parseInt(countRaw || '1', 10));
      if (!barcode || Number.isNaN(count) || count < 1) continue;
      for (let i = 0; i < count; i++) expanded.push(barcode);
    }
    return expanded;
  }

  async function fastIncomingInsert(expanded) {
    if (!expanded.length) return;
    if (!isTabActive()) return;

    await withGlobalProcessGuard({}, async () => {
      if (typeof window.addBarcodeToTasks !== 'function') {
        await waitFor(() => (typeof window.addBarcodeToTasks === 'function' ? true : null), { timeoutMs: 20000, intervalMs: 100 });
      }

      wrapIncomingFunctionsToRequireFocus();

      try {
        freezeUI();
        const useNoYield = (typeof NO_CHUNK_YIELD === 'undefined') ? true : NO_CHUNK_YIELD;

        if (useNoYield) {
          for (const bc of expanded) injectScanTask(bc);
        } else {
          for (let i = 0; i < expanded.length; i += CHUNK_SIZE) {
            const chunk = expanded.slice(i, i + CHUNK_SIZE);
            for (const bc of chunk) injectScanTask(bc);
            await sleep(YIELD_MS);
          }
        }
      } finally {
        unfreezeUI();
      }

      scheduleIncomingProcessKick();
    });
  }

  // -------------------------
  // Clipboard processing
  // -------------------------
  async function processClipboard(text) {
    if (!isTabActive()) return;

    if (isIncoming && INCOMING_FAST_BULK) {
      const expanded = parseClipboardLinesToExpanded(text);
      await fastIncomingInsert(expanded);
      return;
    }

    const lines = (text || '').trim().split('\n');
    for (const line of lines) {
      const [barcodeRaw, countRaw] = line.split('\t');
      const barcode = (barcodeRaw || '').trim();
      const count = Math.abs(parseInt(countRaw || '1', 10));
      if (!barcode || Number.isNaN(count)) continue;

      if (isIncoming && BUFFER_INCOMING) enqueueScan(barcode, count);
      else for (let i = 0; i < count; i++) injectScanTask(barcode);
    }
    scheduleIncomingProcessKick();
  }

  // -------------------------
  // Barcode Button
  // -------------------------
  function addBarcodeButton() {
    if (document.getElementById('simuleer-scan-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'simuleer-scan-btn';
    btn.type = 'button';
    btn.innerHTML = `<i class="fa-solid fa-barcode"></i>`;

    Object.assign(btn.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999,
      padding: '10px 15px', fontSize: '16px',
      backgroundColor: '#007bff', color: '#fff',
      border: 'none', borderRadius: '6px',
      cursor: 'pointer', display: 'flex', alignItems: 'center',
      transition: 'background-color 0.2s',
      boxShadow: '0 6px 20px rgba(0,0,0,0.2)'
    });

    btn.addEventListener('mouseenter', () => (btn.style.backgroundColor = '#28a745'));
    btn.addEventListener('mouseleave', () => (btn.style.backgroundColor = '#007bff'));

    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();

      if (!isTabActive()) {
        alert('Tab is niet actief. Klik eerst in dit tabblad en probeer opnieuw.');
        return;
      }

      const prevDisabled = btn.disabled;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.cursor = 'not-allowed';

      let content = '';
      try {
        content = await navigator.clipboard.readText();
      } catch (err) {
        console.error('[ScanSim] Clipboard readText failed', err);
        alert('Klembord lezen mislukt (browser policy/focus). Zie console.');
        btn.disabled = prevDisabled;
        btn.style.opacity = '';
        btn.style.cursor = 'pointer';
        return;
      }

      try {
        await withGlobalProcessGuard({ clipboardText: content, sameClipboardWindowMs: 1500 }, () => processClipboard(content));
      } finally {
        btn.disabled = prevDisabled;
        btn.style.opacity = '';
        btn.style.cursor = 'pointer';
      }
    });

    document.body.appendChild(btn);
  }

  // =====================================================================
  // BATCH MODULE (incoming)
  // =====================================================================

  function loadBatchState() {
    try {
      const raw = localStorage.getItem(SCANSIM_BATCH.storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function saveBatchState(state) { localStorage.setItem(SCANSIM_BATCH.storageKey, JSON.stringify(state)); }
  function clearBatchState() { localStorage.removeItem(SCANSIM_BATCH.storageKey); }

  function countRemainingLines(items) {
    return (items || []).reduce((n, it) => n + ((it.remaining || 0) > 0 ? 1 : 0), 0);
  }
  function getProgressLines(state) {
    const total = state?.meta?.totalLines ?? (state?.items?.length ?? 0);
    const remaining = countRemainingLines(state?.items || []);
    const done = Math.max(0, total - remaining);
    return { done, total, remaining };
  }
  function countTotalRemaining(items) {
    return (items || []).reduce((n, it) => n + (it.remaining || 0), 0);
  }

  function parseEanCountLinesToItems(text) {
    const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      const [eanRaw, countRaw] = line.split('\t');
      const ean = (eanRaw || '').trim();
      const n = Math.abs(parseInt((countRaw || '1').trim(), 10));
      if (!ean || !Number.isFinite(n) || n < 1) continue;
      items.push({ ean, remaining: n });
    }
    return items;
  }

  function takePendingFromState(state, maxUniqueLines) {
    const pending = [];
    for (const it of state.items) {
      if (pending.length >= maxUniqueLines) break;
      if ((it.remaining || 0) > 0) pending.push({ ean: it.ean, qty: it.remaining });
    }
    return pending;
  }

  function commitPendingToState(state, pending) {
    const map = new Map();
    for (const p of pending) map.set(p.ean, (map.get(p.ean) || 0) + p.qty);

    for (const it of state.items) {
      const dec = map.get(it.ean) || 0;
      if (dec) it.remaining = Math.max(0, it.remaining - dec);
    }
    state.items = state.items.filter(it => it.remaining > 0);
  }

  function initBatchModule() {
    if (!isIncoming || !SCANSIM_BATCH.enabled) return;
    addBatchButtons();
    installCommitOnRegisterButton();
    const state = loadBatchState();
    if (state?.items?.length) showContinueBadge(state);
  }

  function addBatchButtons() {
    if (document.getElementById('scansim-batch-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'scansim-batch-btn';
    btn.type = 'button';
    btn.title = 'Batch scanner: plak EAN\\tAANTAL, injecteer per batch. Commit pas bij "Ontvangst registreren".';
    btn.innerHTML = `<i class="fa-solid fa-layer-group"></i>`;
    Object.assign(btn.style, {
      position: 'fixed', bottom: '20px', right: '140px', zIndex: 9999,
      padding: '10px 12px', fontSize: '16px',
      backgroundColor: '#6f42c1', color: '#fff',
      border: 'none', borderRadius: '6px',
      cursor: 'pointer', display: 'flex', alignItems: 'center',
      boxShadow: '0 6px 20px rgba(0,0,0,0.2)'
    });

    btn.addEventListener('mouseenter', () => (btn.style.backgroundColor = '#5a35a1'));
    btn.addEventListener('mouseleave', () => (btn.style.backgroundColor = '#6f42c1'));

    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      openBatchModal();
    });

    document.body.appendChild(btn);
  }

  function openBatchModal() {
    if (document.getElementById('scansim-batch-modal')) {
      document.getElementById('scansim-batch-modal').style.display = 'flex';
      refreshBatchInfo();
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'scansim-batch-modal';
    Object.assign(modal.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(0,0,0,0.45)',
      zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      width: 'min(900px, 96vw)',
      background: '#fff',
      borderRadius: '10px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
      padding: '14px'
    });

    const title = document.createElement('div');
    title.textContent = `Batch scanner (incoming) — formaat: EAN<TAB>AANTAL`;
    Object.assign(title.style, { fontWeight: '700', marginBottom: '8px' });

    const textarea = document.createElement('textarea');
    textarea.id = 'scansim-batch-textarea';
    textarea.placeholder = `Plak hier je regels:\n1234567890123\t10\n9876543210987\t3\n...`;
    Object.assign(textarea.style, {
      width: '100%', height: '300px',
      padding: '10px',
      borderRadius: '8px',
      border: '1px solid #ddd',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: '12px',
      resize: 'vertical'
    });

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '10px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' });

    const btnStart = document.createElement('button');
    btnStart.textContent = `Opslaan & injecteer volgende ${SCANSIM_BATCH.batchSize}`;
    styleModalBtn(btnStart, '#6f42c1');

    const btnContinue = document.createElement('button');
    btnContinue.textContent = `Injecteer volgende ${SCANSIM_BATCH.batchSize} (uit opslag)`;
    styleModalBtn(btnContinue, '#0d6efd');

    const btnClear = document.createElement('button');
    btnClear.textContent = `Reset batch (verwijder opslag)`;
    styleModalBtn(btnClear, '#dc3545');

    const btnClose = document.createElement('button');
    btnClose.textContent = `Sluiten`;
    styleModalBtn(btnClose, '#6c757d');

    const info = document.createElement('div');
    info.id = 'scansim-batch-info';
    Object.assign(info.style, { marginTop: '10px', color: '#333', fontSize: '13px' });

    btnStart.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      const text = textarea.value || '';
      const items = parseEanCountLinesToItems(text);
      if (!items.length) { setBatchInfo('Geen geldige regels. Gebruik: EAN<TAB>AANTAL', true); return; }
      saveBatchState({ items, meta: { createdAt: Date.now(), totalLines: items.length } });
      setBatchInfo(`Opgeslagen: ${countTotalRemaining(items)} scans totaal. Injecteren...`);
      showContinueBadge({ items, meta: { totalLines: items.length } });
      await runNextBatch();
    });

    btnContinue.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      await runNextBatch();
    });

    btnClear.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      clearBatchState();
      clearPending();
      setBatchInfo('Batch opslag verwijderd.');
      hideContinueBadge();
    });

    btnClose.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      modal.style.display = 'none';
    });

    row.append(btnStart, btnContinue, btnClear, btnClose);
    card.append(title, textarea, row, info);
    modal.append(card);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    document.body.appendChild(modal);
    refreshBatchInfo();
  }

  function styleModalBtn(btn, bg) {
    Object.assign(btn.style, {
      padding: '8px 12px',
      borderRadius: '8px',
      border: 'none',
      cursor: 'pointer',
      background: bg,
      color: '#fff',
      fontWeight: 600
    });
  }

  function setBatchInfo(msg, isError = false) {
    const el = document.getElementById('scansim-batch-info');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#b00020' : '#333';
  }

  function refreshBatchInfo() {
    const state = loadBatchState();
    const pend = loadPending();

    if (pend?.pending?.length) {
      setBatchInfo(`Er staat een geïnjecteerde batch klaar: ${pend.pending.length} regels. Klik nu "Ontvangst registreren".`, true);
      if (state?.items?.length) showContinueBadge(state);
      return;
    }

    if (state?.items?.length) {
      const prog = getProgressLines(state);
      setBatchInfo(`Voortgang: ${prog.done}/${prog.total} regels. Volgende batch: ${SCANSIM_BATCH.batchSize} regels.`);
      showContinueBadge(state);
    } else {
      setBatchInfo('Nog niets opgeslagen.');
      hideContinueBadge();
    }
  }

  function showContinueBadge(state) {
    if (!isIncoming) return;
    const prog = getProgressLines(state);
    if (!prog.total) return;

    const existing = document.getElementById('scansim-batch-continue');
    const label = `Volgende ${SCANSIM_BATCH.batchSize} regels · ${prog.done}/${prog.total}`;
    if (existing) { existing.textContent = label; return; }

    const btn = document.createElement('button');
    btn.id = 'scansim-batch-continue';
    btn.type = 'button';
    btn.textContent = label;

    Object.assign(btn.style, {
      position: 'fixed', bottom: '20px', right: '260px', zIndex: 9999,
      padding: '10px 12px', fontSize: '13px',
      backgroundColor: '#0d6efd', color: '#fff',
      border: 'none', borderRadius: '6px',
      cursor: 'pointer', display: 'flex', alignItems: 'center',
      boxShadow: '0 6px 20px rgba(0,0,0,0.2)'
    });

    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      await runNextBatch();
    });

    document.body.appendChild(btn);
  }

  function hideContinueBadge() { document.getElementById('scansim-batch-continue')?.remove(); }

  async function runNextBatch() {
    if (!isIncoming) return;
    if (!isTabActive()) { setBatchInfo('Tab is niet actief.', true); return; }
    if (__scansimProcessing) { setBatchInfo('Er loopt al een injectie/scan.', true); return; }

    const state = loadBatchState();
    if (!state?.items?.length) { setBatchInfo('Geen batch opgeslagen.', true); hideContinueBadge(); return; }

    const alreadyPending = loadPending();
    if (alreadyPending?.pending?.length) {
      setBatchInfo(`Er staat nog een batch klaar (${alreadyPending.total} scans). Klik eerst "Ontvangst registreren".`, true);
      return;
    }

    await waitFor(() => (typeof window.addBarcodeToTasks === 'function' ? true : null), { timeoutMs: 20000, intervalMs: 100 });
    wrapIncomingFunctionsToRequireFocus();

    const pending = takePendingFromState(state, SCANSIM_BATCH.batchSize);
    if (!pending.length) {
      clearBatchState(); hideContinueBadge(); setBatchInfo('Batch is leeg ✅', false);
      return;
    }

    const total = pending.reduce((s, p) => s + p.qty, 0);
    savePending({ pending, total, createdAt: Date.now() });

    await withGlobalProcessGuard({}, async () => {
      try { freezeUI(); } catch (_) {}

      let inserted = 0;
      try {
        for (const p of pending) {
          for (let i = 0; i < p.qty; i++) {
            window.addBarcodeToTasks(p.ean);
            inserted++;
          }
        }
      } finally {
        try { unfreezeUI(); } catch (_) {}
      }

      scheduleIncomingProcessKick();
      setBatchInfo(`Batch ingevoerd: ${inserted} scans ✅ Klik nu "Ontvangst registreren".`, false);
      showContinueBadge(state);
    });
  }

  function installCommitOnRegisterButton() {
    if (!isIncoming) return;
    if (window.__scansimCommitHookInstalled) return;
    window.__scansimCommitHookInstalled = true;

    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button.attach_scanned_products');
      if (!btn) return;

      const pend = loadPending();
      if (!pend?.pending?.length) return;

      try {
        const state = loadBatchState();
        if (!state?.items?.length) return;

        commitPendingToState(state, pend.pending);

        if (state.items.length) saveBatchState(state);
        else clearBatchState();

        clearPending();
        refreshBatchInfo();
      } catch (err) {
        console.error('[ScanSim] Commit failed', err);
      }
    }, true);
  }

  // -------------------------
  // Barcode Button
  // -------------------------
  function addBarcodeButton() {
    if (document.getElementById('simuleer-scan-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'simuleer-scan-btn';
    btn.type = 'button';
    btn.innerHTML = `<i class="fa-solid fa-barcode"></i>`;

    Object.assign(btn.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999,
      padding: '10px 15px', fontSize: '16px',
      backgroundColor: '#007bff', color: '#fff',
      border: 'none', borderRadius: '6px',
      cursor: 'pointer', display: 'flex', alignItems: 'center',
      transition: 'background-color 0.2s',
      boxShadow: '0 6px 20px rgba(0,0,0,0.2)'
    });

    btn.addEventListener('mouseenter', () => (btn.style.backgroundColor = '#28a745'));
    btn.addEventListener('mouseleave', () => (btn.style.backgroundColor = '#007bff'));

    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      if (!isTabActive()) { alert('Tab is niet actief. Klik eerst in dit tabblad.'); return; }

      const prevDisabled = btn.disabled;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.cursor = 'not-allowed';

      let content = '';
      try {
        content = await navigator.clipboard.readText();
      } catch (err) {
        console.error('[ScanSim] Clipboard readText failed', err);
        alert('Klembord lezen mislukt. Zie console.');
        btn.disabled = prevDisabled;
        btn.style.opacity = '';
        btn.style.cursor = 'pointer';
        return;
      }

      try {
        await withGlobalProcessGuard({ clipboardText: content, sameClipboardWindowMs: 1500 }, () => processClipboard(content));
      } finally {
        btn.disabled = prevDisabled;
        btn.style.opacity = '';
        btn.style.cursor = 'pointer';
      }
    });

    document.body.appendChild(btn);
  }

  // -------------------------
  // Clipboard processing
  // -------------------------
  async function processClipboard(text) {
    if (!isTabActive()) return;

    if (isIncoming && INCOMING_FAST_BULK) {
      const expanded = parseClipboardLinesToExpanded(text);
      await fastIncomingInsert(expanded);
      return;
    }

    const lines = (text || '').trim().split('\n');
    for (const line of lines) {
      const [barcodeRaw, countRaw] = line.split('\t');
      const barcode = (barcodeRaw || '').trim();
      const count = Math.abs(parseInt(countRaw || '1', 10));
      if (!barcode || Number.isNaN(count)) continue;

      if (isIncoming && BUFFER_INCOMING) enqueueScan(barcode, count);
      else for (let i = 0; i < count; i++) injectScanTask(barcode);
    }
    scheduleIncomingProcessKick();
  }

  // -------------------------
  // Fast incoming bulk
  // -------------------------
  function parseClipboardLinesToExpanded(text) {
    const lines = (text || '').trim().split('\n');
    const expanded = [];
    for (const line of lines) {
      const [barcodeRaw, countRaw] = line.split('\t');
      const barcode = (barcodeRaw || '').trim();
      const count = Math.abs(parseInt(countRaw || '1', 10));
      if (!barcode || Number.isNaN(count) || count < 1) continue;
      for (let i = 0; i < count; i++) expanded.push(barcode);
    }
    return expanded;
  }

  async function fastIncomingInsert(expanded) {
    if (!expanded.length) return;
    if (!isTabActive()) return;

    await withGlobalProcessGuard({}, async () => {
      if (typeof window.addBarcodeToTasks !== 'function') {
        await waitFor(() => (typeof window.addBarcodeToTasks === 'function' ? true : null), { timeoutMs: 20000, intervalMs: 100 });
      }

      wrapIncomingFunctionsToRequireFocus();

      try {
        freezeUI();
        const useNoYield = (typeof NO_CHUNK_YIELD === 'undefined') ? true : NO_CHUNK_YIELD;

        if (useNoYield) {
          for (const bc of expanded) injectScanTask(bc);
        } else {
          for (let i = 0; i < expanded.length; i += CHUNK_SIZE) {
            const chunk = expanded.slice(i, i + CHUNK_SIZE);
            for (const bc of chunk) injectScanTask(bc);
            await sleep(YIELD_MS);
          }
        }
      } finally {
        unfreezeUI();
      }

      scheduleIncomingProcessKick();
    });
  }

// -------------------------
// Outgoing scanner loop (origineel)
// -------------------------
let scannerLoopStarted = false;

function activateOutgoingScannerLoop() {
  if (!isOutgoing) return;
  if (scannerLoopStarted) return;

  if (typeof window.executeTasks === 'function') {
    scannerLoopStarted = true;
    setInterval(() => {
      try { window.executeTasks(); }
      catch (e) { console.error('[ScanSim] executeTasks fout', e); }
    }, 1000);
  }
}

  // -------------------------
  // Init
  // -------------------------
  function init() {
    installFetchDedupe();
    installXhrDedupe();

    injectFontAwesome();
    addBarcodeButton();
    addStockCheckButton();
    activateOutgoingScannerLoop();

    initBatchModule();

    if (isIncoming) {
      waitFor(() => (typeof window.addBarcodeToTasks === 'function' ? true : null), { timeoutMs: 20000 })
        .then(() => wrapIncomingFunctionsToRequireFocus())
        .catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
