// ==UserScript==
// @name         Stock Check | Naturana
// @namespace    https://dutchdesignersoutlet.nl/
// @version      5.0.3
// @description  Vergelijk de lokale voorraad van Naturana en Naturana Swim met de leverancier.
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @match        https://naturana-online.de/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_info
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-naturana.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-naturana.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL = location.hostname.includes('lingerieoutlet.nl');
  const ON_NATURANA = location.hostname.includes('naturana-online.de');

  const g =
    typeof unsafeWindow !== 'undefined'
      ? unsafeWindow
      : window;

  const Core = g.VCPCore;
  const SR = g.StockRules;

  const BRAND_KEY = 'naturana';

  const MODELVIEW_URL =
    'https://naturana-online.de/naturana/ModellView';

  const ARTICLEVIEW_URL =
    'https://naturana-online.de/naturana/ArticleView';

  const TIMEOUT_MS = 35000;

  const STOCK_CACHE_KEY =
    'naturana_stock_cache_v5_0_1';

  const STOCK_CACHE_TTL_MS =
    2 * 60 * 1000;

  const STOCK_CACHE_MAX = 300;

  const BRIDGE_KEY =
    'naturana_vcp2_bridge';

  const HEARTBEAT_KEY =
    `${BRIDGE_KEY}_hb`;

  const LEADER_KEY =
    `${BRIDGE_KEY}_leader_v5`;

  const HB_INTERVAL_MS = 2500;
  const LEADER_TTL_MS = 7000;

  const CHANNELS = [
    {
      req: `${BRIDGE_KEY}_req_adv`,
      resp: `${BRIDGE_KEY}_resp_adv`,
      ping: `${BRIDGE_KEY}_ping_adv`,
      pong: `${BRIDGE_KEY}_pong_adv`,
    },
    {
      req: `${BRIDGE_KEY}_req_v2`,
      resp: `${BRIDGE_KEY}_resp_v2`,
      ping: `${BRIDGE_KEY}_ping_v2`,
      pong: `${BRIDGE_KEY}_pong_v2`,
    },
    {
      req: `${BRIDGE_KEY}_req_v1`,
      resp: `${BRIDGE_KEY}_resp_v1`,
      ping: `${BRIDGE_KEY}_ping_v1`,
      pong: `${BRIDGE_KEY}_pong_v1`,
    },
  ];

  const PRIMARY_CHANNEL = CHANNELS[0];

  const uid = () =>
    Math.random().toString(36).slice(2) +
    Date.now().toString(36);

  const delay = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const parseHTML = (html) =>
    new DOMParser().parseFromString(
      String(html || ''),
      'text/html'
    );

  function registerUserscript() {
    const detail = {
      id: 'stock-check-naturana',
      name: 'Stock Check | Naturana',
      version:
        typeof GM_info !== 'undefined'
          ? GM_info.script.version
          : '5.0.3',
    };

    g.__stockCheckUserscripts =
      g.__stockCheckUserscripts ||
      Object.create(null);

    g.__stockCheckUserscripts[detail.id] = detail;

    try {
      g.dispatchEvent(
        new g.CustomEvent(
          'stockcheck:userscript-register',
          { detail }
        )
      );
    } catch {}
  }

  function looksLikeLogin(html) {
    const text =
      String(html || '').toLowerCase();

    return (
      /login|passwort|password|anmelden/i.test(text) &&
      /<form|input|button/i.test(text)
    );
  }

  if (ON_TOOL) {
    if (!Core) {
      console.error(
        '[VCP2|Naturana] VCPCore ontbreekt. Controleer @require vcp-core.js.'
      );

      return;
    }

    if (
      !SR ||
      typeof SR.mapRemoteToTarget !== 'function' ||
      typeof SR.reconcile !== 'function'
    ) {
      console.error(
        '[VCP2|Naturana] StockRules ontbreekt of is incompleet.'
      );

      return;
    }
  }

  const Logger = {
    lb() {
      return (
        typeof unsafeWindow !== 'undefined' &&
        unsafeWindow.logboek
      )
        ? unsafeWindow.logboek
        : window.logboek;
    },

    status(anchorId, text) {
      const lb = this.lb();

      if (lb?.resultaat) {
        lb.resultaat(
          String(anchorId),
          String(text)
        );
      } else {
        console.info(
          `[Naturana][${anchorId}] status: ${text}`
        );
      }
    },

    perMaat(anchorId, report) {
      if (
        g.StockCheckConfig?.detailLogging !== true
      ) {
        return;
      }

      console.groupCollapsed(
        `[Naturana][${anchorId}] maatvergelijking`
      );

      try {
        console.table(
          report.map((row) => ({
            maat: row.maat,
            local: row.local,
            remote: row.remote ?? '-',
            target: Number.isFinite(row.target)
              ? row.target
              : '-',
            delta: Number.isFinite(row.delta)
              ? row.delta
              : '-',
            status: row.status,
          }))
        );
      } finally {
        console.groupEnd();
      }
    },
  };

  // =========================================================
  // Bridge op het Naturana-tabblad
  // =========================================================

  function workerInitBridge() {
    const workerId = uid();

    let isLeader = false;
    let active = 0;

    const queue = [];
    const seenRequestIds = new Set();

    const BRIDGE_CONCURRENCY = 1;

    function acceptRequest(
      channel,
      request,
      recovered = false
    ) {
      if (
        !isLeader ||
        !request?.id ||
        !request?.url
      ) {
        return;
      }

      if (seenRequestIds.has(request.id)) {
        return;
      }

      if (recovered) {
        const createdAt =
          Number(request.createdAt || 0);

        const maxAge =
          Math.max(
            5000,
            Number(request.timeout || TIMEOUT_MS)
          ) + 5000;

        if (
          !createdAt ||
          Date.now() - createdAt > maxAge
        ) {
          return;
        }

        const existingResponse =
          GM_getValue(channel.resp, null);

        if (
          existingResponse?.id === request.id
        ) {
          return;
        }
      }

      seenRequestIds.add(request.id);

      queue.push({
        ...request,
        _responseKey: channel.resp,
      });

      pump();
    }

    function recoverPendingRequests() {
      if (!isLeader) {
        return;
      }

      for (const channel of CHANNELS) {
        try {
          acceptRequest(
            channel,
            GM_getValue(channel.req, null),
            true
          );
        } catch {}
      }
    }

    function maintainLeadership() {
      try {
        const wasLeader = isLeader;
        const timestamp = Date.now();

        const current =
          GM_getValue(LEADER_KEY, null);

        const stale =
          !current?.id ||
          !Number.isFinite(current.time) ||
          timestamp - current.time >
            LEADER_TTL_MS;

        if (
          current?.id === workerId ||
          stale
        ) {
          GM_setValue(
            LEADER_KEY,
            {
              id: workerId,
              time: timestamp,
            }
          );

          const check =
            GM_getValue(LEADER_KEY, null);

          isLeader =
            check?.id === workerId;
        } else {
          isLeader = false;
        }

        if (isLeader) {
          GM_setValue(
            HEARTBEAT_KEY,
            timestamp
          );

          if (!wasLeader) {
            recoverPendingRequests();
          }
        }
      } catch {
        isLeader = false;
      }
    }

    async function handleOne(request) {
      const responseKey =
        request._responseKey;

      let timeoutHandle = null;

      try {
        const controller =
          new AbortController();

        timeoutHandle = setTimeout(
          () => controller.abort(),
          Math.max(
            5000,
            request.timeout || TIMEOUT_MS
          )
        );

        const response =
          await fetch(request.url, {
            method: request.method || 'GET',
            headers: request.headers || {},
            credentials: 'include',
            body: request.body || null,
            signal: controller.signal,
          });

        const text =
          await response.text();

        clearTimeout(timeoutHandle);

        GM_setValue(
          responseKey,
          {
            id: request.id,
            ok: true,
            status: response.status,
            text,
          }
        );
      } catch (error) {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        GM_setValue(
          responseKey,
          {
            id: request.id,
            ok: false,
            error: String(error),
          }
        );
      }
    }

    function pump() {
      while (
        active < BRIDGE_CONCURRENCY &&
        queue.length
      ) {
        const request = queue.shift();

        active += 1;

        handleOne(request)
          .finally(() => {
            active -= 1;
            pump();
          });
      }
    }

    maintainLeadership();

    setInterval(
      maintainLeadership,
      HB_INTERVAL_MS
    );

    CHANNELS.forEach((channel) => {
      try {
        GM_addValueChangeListener(
          channel.ping,
          (_name, _oldValue, message) => {
            if (
              isLeader &&
              message === 'ping'
            ) {
              GM_setValue(
                channel.pong,
                `pong:${Date.now()}`
              );
            }
          }
        );
      } catch {}
    });

    CHANNELS.forEach((channel) => {
      try {
        GM_addValueChangeListener(
          channel.req,
          (
            _name,
            _oldValue,
            request
          ) => {
            if (!isLeader) {
              return;
            }

            acceptRequest(
              channel,
              request,
              false
            );
          }
        );
      } catch {}
    });

    maintainLeadership();
  }

  // =========================================================
  // Bridge op de stocktool
  // =========================================================

  function bridgeOnline(maxAgeMs = 6000) {
    try {
      const timestamp =
        GM_getValue(HEARTBEAT_KEY, 0);

      return Boolean(
        timestamp &&
        Date.now() - timestamp < maxAgeMs
      );
    } catch {
      return false;
    }
  }

  function installHeartbeatBadge(button) {
    if (
      !button ||
      button.querySelector(
        '.supplier-bridge-badge'
      )
    ) {
      return;
    }

    button.style.position = 'relative';

    const badge =
      document.createElement('span');

    badge.className =
      'supplier-bridge-badge';

    badge.setAttribute(
      'aria-hidden',
      'true'
    );

    button.appendChild(badge);

    const update = () => {
      const online = bridgeOnline();

      badge.classList.toggle(
        'is-online',
        online
      );

      button.dataset.bridgeOnline =
        online ? '1' : '0';

      if (
        !button.classList.contains('is-busy')
      ) {
        button.title = online
          ? 'Controleer voorraad bij Naturana'
          : 'Open naturana-online.de, log in en laat het tabblad open';
      }
    };

    update();

    window.setInterval(update, 2500);

    try {
      GM_addValueChangeListener(
        HEARTBEAT_KEY,
        update
      );
    } catch {}
  }

  function bridgeSend({
    url,
    method = 'GET',
    headers = {},
    body = null,
    timeout = TIMEOUT_MS,
  }) {
    const id = uid();

    return new Promise(
      (resolve, reject) => {
        const handles = [];
        let settled = false;

        const removeListeners = () => {
          handles.forEach((handle) => {
            try {
              GM_removeValueChangeListener(
                handle
              );
            } catch {}
          });
        };

        const handle =
          GM_addValueChangeListener(
            PRIMARY_CHANNEL.resp,
            (
              _name,
              _oldValue,
              message
            ) => {
              if (
                settled ||
                !message ||
                message.id !== id
              ) {
                return;
              }

              settled = true;
              removeListeners();

              if (message.ok) {
                resolve(message);
              } else {
                reject(
                  new Error(
                    message.error ||
                    'bridge error'
                  )
                );
              }
            }
          );

        handles.push(handle);

        GM_setValue(
          PRIMARY_CHANNEL.req,
          {
            id,
            createdAt: Date.now(),
            url,
            method,
            headers,
            body,
            timeout,
          }
        );

        setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;
          removeListeners();

          reject(
            new Error('bridge timeout')
          );
        }, timeout + 1500);
      }
    );
  }

  const httpGET = (url) =>
    bridgeSend({
      url,
      method: 'GET',
    });

  function httpPOST(url, dataObject) {
    const body =
      new URLSearchParams(
        dataObject || {}
      ).toString();

    return bridgeSend({
      url,
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body,
    });
  }

  // =========================================================
  // ASP.NET helpers
  // =========================================================

  function pickViewState(documentRoot) {
    const form =
      documentRoot.querySelector('form');

    if (!form) {
      return null;
    }

    const get = (name) =>
      form.querySelector(
        `input[name="${name}"]`
      )?.value ?? '';

    return {
      __VIEWSTATE:
        get('__VIEWSTATE'),

      __VIEWSTATEGENERATOR:
        get('__VIEWSTATEGENERATOR'),

      __EVENTVALIDATION:
        get('__EVENTVALIDATION'),
    };
  }

  function getFormAction(
    documentRoot,
    fallbackUrl
  ) {
    const form =
      documentRoot.querySelector('form');

    const action =
      (
        form?.getAttribute('action') || ''
      ).trim();

    try {
      return new URL(
        action || '',
        fallbackUrl
      ).toString();
    } catch {
      return fallbackUrl;
    }
  }

  function serializeForm(form) {
    const payload = {};

    if (!form?.elements) {
      return payload;
    }

    for (
      const element
      of Array.from(form.elements)
    ) {
      if (!element?.name) {
        continue;
      }

      const tag =
        String(element.tagName || '')
          .toLowerCase();

      const type =
        String(element.type || '')
          .toLowerCase();

      if (
        (
          type === 'checkbox' ||
          type === 'radio'
        ) &&
        !element.checked
      ) {
        continue;
      }

      if (
        tag === 'select' &&
        element.multiple
      ) {
        const selected =
          Array.from(element.options)
            .filter(
              (option) => option.selected
            )
            .map(
              (option) => option.value
            );

        if (selected.length) {
          payload[element.name] =
            selected[0];
        }

        continue;
      }

      payload[element.name] =
        element.value ?? '';
    }

    return payload;
  }

  function addImageSubmit(
    payload,
    imageName
  ) {
    payload[`${imageName}.x`] = '1';
    payload[`${imageName}.y`] = '1';
  }

  // =========================================================
  // Maten
  // =========================================================

  const SIZE_ALIAS = {
    '2XL': 'XXL',
    XXL: '2XL',

    '3XL': 'XXXL',
    XXXL: '3XL',

    '4XL': 'XXXXL',
    XXXXL: '4XL',

    '3L': '3XL',

    'XS/S': 'XS',
    'S/M': 'M',
    'M/L': 'L',
    'L/XL': 'XL',
    'XL/2XL': '2XL',
  };

  function normalizeSizeKey(raw) {
    let value =
      String(raw ?? '').trim();

    if (!value) {
      return '';
    }

    value = value.split(/[|,]/)[0];

    value = value
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');

    if (SIZE_ALIAS[value]) {
      value = SIZE_ALIAS[value];
    }

    return value;
  }

  function aliasCandidates(label) {
    const raw =
      String(label || '')
        .trim()
        .toUpperCase();

    const noSpaces =
      raw.replace(/\s+/g, '');

    const candidates =
      new Set([raw, noSpaces]);

    if (SIZE_ALIAS[raw]) {
      candidates.add(SIZE_ALIAS[raw]);
    }

    if (SIZE_ALIAS[noSpaces]) {
      candidates.add(
        SIZE_ALIAS[noSpaces]
      );
    }

    if (raw.includes('/')) {
      raw
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          candidates.add(part);

          candidates.add(
            part.replace(/\s+/g, '')
          );

          if (SIZE_ALIAS[part]) {
            candidates.add(
              SIZE_ALIAS[part]
            );
          }
        });
    }

    return Array.from(candidates);
  }

  /*
   * Deze functie ontbrak in 5.0.2.
   * Zonder deze functie stopt de vergelijking
   * met een ReferenceError en blijven counters
   * op nul staan.
   */
  function resolveRemoteQty(
    stockMap,
    localSize
  ) {
    if (!(stockMap instanceof Map)) {
      return undefined;
    }

    for (
      const candidate
      of aliasCandidates(localSize)
    ) {
      const key =
        normalizeSizeKey(candidate);

      if (!stockMap.has(key)) {
        continue;
      }

      const quantity =
        Number(stockMap.get(key));

      if (Number.isFinite(quantity)) {
        return quantity;
      }
    }

    return undefined;
  }

  // =========================================================
  // Voorraadcache
  // =========================================================

  function readStockCache(sku) {
    try {
      const all =
        GM_getValue(
          STOCK_CACHE_KEY,
          {}
        );

      const key =
        String(sku || '')
          .toUpperCase();

      const hit = all?.[key];

      if (
        !hit ||
        !Array.isArray(hit.entries) ||
        !Number.isFinite(hit.time)
      ) {
        return null;
      }

      if (
        Date.now() - hit.time >
        STOCK_CACHE_TTL_MS
      ) {
        return null;
      }

      return new Map(hit.entries);
    } catch {
      return null;
    }
  }

  function writeStockCache(
    sku,
    stockMap
  ) {
    try {
      const key =
        String(sku || '')
          .toUpperCase();

      if (
        !key ||
        !(stockMap instanceof Map) ||
        stockMap.size === 0
      ) {
        return;
      }

      const all =
        GM_getValue(
          STOCK_CACHE_KEY,
          {}
        );

      const clean = {};
      const timestamp = Date.now();

      for (
        const [cacheKey, value]
        of Object.entries(all || {})
      ) {
        if (
          value &&
          Number.isFinite(value.time) &&
          timestamp - value.time <=
            STOCK_CACHE_TTL_MS
        ) {
          clean[cacheKey] = value;
        }
      }

      clean[key] = {
        time: timestamp,
        entries: [...stockMap.entries()],
      };

      const newest =
        Object.entries(clean)
          .sort(
            (a, b) =>
              (b[1]?.time || 0) -
              (a[1]?.time || 0)
          )
          .slice(0, STOCK_CACHE_MAX);

      GM_setValue(
        STOCK_CACHE_KEY,
        Object.fromEntries(newest)
      );
    } catch (error) {
      console.warn(
        '[VCP2|Naturana] Stockcache opslaan mislukt:',
        error
      );
    }
  }

  function dropStockCache(sku) {
    try {
      const key =
        String(sku || '')
          .toUpperCase();

      const all =
        GM_getValue(
          STOCK_CACHE_KEY,
          {}
        );

      if (
        all &&
        Object.prototype.hasOwnProperty.call(
          all,
          key
        )
      ) {
        delete all[key];

        GM_setValue(
          STOCK_CACHE_KEY,
          all
        );
      }
    } catch {}
  }

  // =========================================================
  // Exact model zoeken
  // =========================================================

  function splitSku(pidColor) {
    const raw =
      String(pidColor || '')
        .trim()
        .toUpperCase();

    const match =
      raw.match(/^(.+?)-(.*)$/);

    const pid =
      (
        match ? match[1] : raw
      ).trim();

    const color =
      (
        match ? match[2] : ''
      ).trim();

    return {
      pid,
      colorDigits:
        color.replace(/\D/g, ''),
    };
  }

  function buildModelIndex(documentRoot) {
    const index = new Map();

    const spans =
      Array.from(
        documentRoot.querySelectorAll(
          'span[id*="lblArticleNo"]'
        )
      );

    for (const span of spans) {
      const pid =
        String(span.textContent || '')
          .trim()
          .toUpperCase();

      if (!pid || index.has(pid)) {
        continue;
      }

      const container =
        span.closest('.mod-container-col');

      if (!container) {
        continue;
      }

      const link =
        container.querySelector(
          'a[id*="linkArticleNo"][href*="__doPostBack"]'
        );

      const href =
        link?.getAttribute('href') || '';

      const postBack =
        href.match(
          /__doPostBack\('([^']+)'\s*,\s*'([^']*)'\)/i
        );

      if (!postBack) {
        continue;
      }

      index.set(pid, {
        pid,
        eventTarget: postBack[1],
        eventArgument:
          postBack[2] || '',
      });
    }

    return index;
  }

  function findModelItemExact(
    pidColor,
    modelIndex
  ) {
    const {
      pid,
      colorDigits,
    } = splitSku(pidColor);

    if (
      !pid ||
      !colorDigits ||
      !(modelIndex instanceof Map)
    ) {
      return null;
    }

    const indexed =
      modelIndex.get(pid);

    if (!indexed) {
      return null;
    }

    return {
      ...indexed,
      colorDigits,
    };
  }

  // =========================================================
  // Exacte kleur selecteren
  // =========================================================

  async function ensureArticleViewColor(
    html,
    colorDigits,
    fallbackUrl
  ) {
    const documentRoot =
      parseHTML(html);

    const current =
      (
        documentRoot.querySelector(
          '.div-art-color .art-color-text'
        )?.textContent || ''
      ).trim() ||
      (
        documentRoot.querySelector(
          '[id*="lblColorNr"]'
        )?.textContent || ''
      ).trim();

    if (
      String(current).replace(/\D/g, '') ===
      String(colorDigits)
    ) {
      return html;
    }

    const colorBlocks =
      Array.from(
        documentRoot.querySelectorAll(
          '.art-color'
        )
      );

    const wanted =
      colorBlocks.find((block) => {
        const number =
          (
            block.querySelector(
              '.art-color-no'
            )?.textContent || ''
          ).trim();

        return (
          String(number).replace(/\D/g, '') ===
          String(colorDigits)
        );
      });

    if (!wanted) {
      throw new Error(
        'TARGET_NOT_FOUND'
      );
    }

    const image =
      wanted.querySelector(
        'input[type="image"][name*="btnSelectColor"]'
      );

    const imageName =
      image?.getAttribute('name') || '';

    if (!imageName) {
      throw new Error(
        'TARGET_NOT_FOUND'
      );
    }

    const form =
      documentRoot.querySelector('form');

    if (!form) {
      throw new Error(
        'TARGET_NOT_FOUND'
      );
    }

    const actionUrl =
      getFormAction(
        documentRoot,
        fallbackUrl
      );

    const payload =
      serializeForm(form);

    if (!('__EVENTTARGET' in payload)) {
      payload.__EVENTTARGET = '';
    }

    if (!('__EVENTARGUMENT' in payload)) {
      payload.__EVENTARGUMENT = '';
    }

    addImageSubmit(
      payload,
      imageName
    );

    const response =
      await httpPOST(
        actionUrl,
        payload
      );

    if (response.status >= 400) {
      throw new Error(
        `HTTP_${response.status}`
      );
    }

    if (looksLikeLogin(response.text)) {
      throw new Error(
        'LOGIN_REQUIRED'
      );
    }

    const checkDocument =
      parseHTML(response.text);

    const selectedColor =
      (
        checkDocument.querySelector(
          '.div-art-color .art-color-text'
        )?.textContent || ''
      ).trim() ||
      (
        checkDocument.querySelector(
          '[id*="lblColorNr"]'
        )?.textContent || ''
      ).trim();

    if (
      String(selectedColor)
        .replace(/\D/g, '') !==
      String(colorDigits)
    ) {
      throw new Error(
        'TARGET_NOT_FOUND'
      );
    }

    return response.text;
  }

  // =========================================================
  // Voorraadstatus uitlezen
  // =========================================================

  function buildStockMapFromArticleView(
    html
  ) {
    const map = new Map();
    const doc = parseHTML(html);

    const GREEN_DIRECT = '#2ae849';
    const BLUE_FUTURE = '#1e6ae8';

    function parseGermanInteger(value) {
      const digits =
        String(value ?? '')
          .replace(/[^\d]/g, '');

      if (!digits) {
        return null;
      }

      const number =
        parseInt(digits, 10);

      return (
        Number.isFinite(number) &&
        number >= 0
      )
        ? number
        : null;
    }

    const tiles =
      Array.from(
        doc.querySelectorAll(
          '.color-size-grid .p-2.text-center, ' +
          '.color-size-grid [id*="_divOID_"]'
        )
      );

    for (const tile of tiles) {
      const sizeElement =
        tile.querySelector('.gridSize');

      const input =
        tile.querySelector(
          'input.gridAmount'
        );

      if (!sizeElement || !input) {
        continue;
      }

      const rawSize =
        String(
          sizeElement.textContent || ''
        )
          .trim()
          .toUpperCase();

      if (!rawSize) {
        continue;
      }

      const sizeKey =
        normalizeSizeKey(rawSize);

      const rawMaximum =
        input.getAttribute('max') ??
        input.getAttribute('data-max') ??
        input.dataset?.max ??
        input.getAttribute('value') ??
        input.value ??
        '0';

      const maximum =
        parseGermanInteger(
          rawMaximum
        ) ?? 0;

      const statusColor =
        String(
          tile.querySelector(
            'input[type="hidden"][name*="hdfColorCode"]'
          )?.value ||
          input.style?.getPropertyValue(
            '--availability-color'
          ) ||
          ''
        )
          .trim()
          .toLowerCase();

      const availabilityText =
        String(
          tile.querySelector(
            '.gridAvailTxt, [id*="lblAvailabilityTxt"]'
          )?.textContent || ''
        )
          .replace(/\s+/g, ' ')
          .trim();

      const deliveryText =
        String(
          tile.querySelector(
            '.gridDelivTxt, [id*="lblDeliveryTxt"]'
          )?.textContent || ''
        )
          .replace(/\s+/g, ' ')
          .trim();

      const stockMatch =
        availabilityText.match(
          /\bBestand\s*([\d.]+)/i
        );

      const directStock =
        stockMatch
          ? parseGermanInteger(
              stockMatch[1]
            )
          : null;

      let quantity;
      let reason;

      if (input.disabled) {
        quantity = 0;
        reason = 'disabled';
      } else if (
        statusColor === BLUE_FUTURE
      ) {
        quantity = 0;

        reason = deliveryText
          ? `toekomst: ${deliveryText}`
          : 'toekomstkleur';
      } else if (
        statusColor === GREEN_DIRECT &&
        directStock !== null
      ) {
        quantity = directStock;

        reason =
          `direct Bestand ${directStock}`;
      } else if (
        statusColor === GREEN_DIRECT &&
        deliveryText
      ) {
        quantity = 0;

        reason =
          `leverdatum zonder Bestand: ${deliveryText}`;
      } else if (
        statusColor === GREEN_DIRECT
      ) {
        quantity = maximum;

        reason =
          `direct max ${maximum}`;
      } else {
        console.warn(
          `[VCP2|Naturana] ${rawSize}: ` +
          'onbekende voorraadstatus ' +
          `(kleur=${statusColor || '-'}, ` +
          `Bestand=${availabilityText || '-'}, ` +
          `levering=${deliveryText || '-'}); ` +
          'maat overgeslagen.'
        );

        continue;
      }

      if (
        g.StockCheckConfig
          ?.detailLogging === true
      ) {
        console.info(
          `[VCP2|Naturana] ${rawSize}: ` +
          `remote ${quantity} ` +
          `(${reason}; max=${maximum})`
        );
      }

      for (
        const candidate
        of aliasCandidates(sizeKey)
      ) {
        map.set(
          normalizeSizeKey(candidate),
          quantity
        );
      }
    }

    return map;
  }

  // =========================================================
  // ModellView ophalen
  // =========================================================

  async function refreshModelState(state) {
    const response =
      await httpGET(MODELVIEW_URL);

    if (response.status >= 400) {
      throw new Error(
        `HTTP_${response.status}`
      );
    }

    if (looksLikeLogin(response.text)) {
      throw new Error(
        'LOGIN_REQUIRED'
      );
    }

    const documentRoot =
      parseHTML(response.text);

    const viewState =
      pickViewState(documentRoot);

    const modelIndex =
      buildModelIndex(documentRoot);

    if (
      !viewState?.__VIEWSTATE ||
      modelIndex.size === 0
    ) {
      throw new Error(
        'TARGET_NOT_FOUND'
      );
    }

    state.viewState = viewState;
    state.modelIndex = modelIndex;
    state.loadedAt = Date.now();

    console.info(
      '[VCP2|Naturana] ' +
      `ModellView geïndexeerd: ` +
      `${modelIndex.size} modellen.`
    );
  }

  function invalidateModelState(state) {
    state.viewState = null;
    state.modelIndex = null;
    state.loadedAt = 0;
  }

  // =========================================================
  // Artikel openen
  // =========================================================

  async function openArticleViewExact(
    pidColor,
    state
  ) {
    let lastError = null;

    for (
      let attempt = 1;
      attempt <= 2;
      attempt += 1
    ) {
      try {
        if (
          !state.viewState ||
          !(state.modelIndex instanceof Map)
        ) {
          await refreshModelState(state);
        }

        const item =
          findModelItemExact(
            pidColor,
            state.modelIndex
          );

        if (!item) {
          throw new Error(
            'TARGET_NOT_FOUND'
          );
        }

        const payload = {
          __EVENTTARGET:
            item.eventTarget || '',

          __EVENTARGUMENT:
            item.eventArgument || '',

          __VIEWSTATE:
            state.viewState.__VIEWSTATE,

          __VIEWSTATEGENERATOR:
            state.viewState
              .__VIEWSTATEGENERATOR || '',

          __EVENTVALIDATION:
            state.viewState
              .__EVENTVALIDATION || '',
        };

        const response =
          await httpPOST(
            MODELVIEW_URL,
            payload
          );

        if (response.status >= 400) {
          throw new Error(
            `HTTP_${response.status}`
          );
        }

        if (looksLikeLogin(response.text)) {
          throw new Error(
            'LOGIN_REQUIRED'
          );
        }

        const html =
          await ensureArticleViewColor(
            response.text,
            item.colorDigits,
            ARTICLEVIEW_URL
          );

        const stockMap =
          buildStockMapFromArticleView(
            html
          );

        if (!stockMap.size) {
          throw new Error(
            'TARGET_NOT_FOUND'
          );
        }

        return {
          html,
          stockMap,
          attempt,
        };
      } catch (error) {
        lastError = error;

        const message =
          String(
            error?.message || error
          );

        if (
          message === 'LOGIN_REQUIRED'
        ) {
          throw error;
        }

        invalidateModelState(state);

        if (attempt < 2) {
          console.warn(
            `[VCP2|Naturana] ${pidColor}: ` +
            `poging 1 mislukt (${message}); ` +
            'verse ViewState ophalen.'
          );

          await delay(300);
        }
      }
    }

    throw (
      lastError ||
      new Error('TARGET_NOT_FOUND')
    );
  }

  // =========================================================
  // Lokale tabel
  // =========================================================

  function readLocalTable(table) {
    const rows =
      Array.from(
        table.querySelectorAll(
          'tbody tr'
        )
      );

    const output = [];

    for (const row of rows) {
      const rawSize =
        row.dataset.size ||
        row.children?.[0]
          ?.textContent ||
        '';

      const size =
        normalizeSizeKey(rawSize);

      if (!size) {
        continue;
      }

      const local =
        parseInt(
          String(
            row.children?.[1]
              ?.textContent || ''
          ).trim(),
          10
        ) || 0;

      output.push({
        tr: row,
        maat: size,
        local,
      });
    }

    return output;
  }

  function getSkuFromTable(table) {
    const id =
      String(table.id || '').trim();

    if (id) {
      return id;
    }

    const label =
      table.querySelector(
        'thead th[colspan]'
      )?.textContent?.trim() || '';

    const match =
      label.match(
        /\b[A-Z0-9]{3,}-[A-Z0-9]{2,}\b/
      );

    return match ? match[0] : '';
  }

  function getMaxCap(table) {
    try {
      if (
        typeof Core.getMaxCap ===
        'function'
      ) {
        return Core.getMaxCap(table);
      }
    } catch {}

    return 5;
  }

  // =========================================================
  // Vergelijken
  // =========================================================

  function applyCompareAndMark(
    localRows,
    stockMap,
    maxCap
  ) {
    const report = [];

    for (const { tr } of localRows) {
      Core.clearRowMarks(tr);
    }

    for (
      const {
        tr,
        maat,
        local,
      }
      of localRows
    ) {
      const remote =
        resolveRemoteQty(
          stockMap,
          maat
        );

      if (
        typeof remote !== 'number'
      ) {
        console.warn(
          `[VCP2|Naturana] Geen remote voorraad gevonden voor maat ${maat}.`
        );

        continue;
      }

      const target =
        SR.mapRemoteToTarget(
          BRAND_KEY,
          remote,
          maxCap
        );

      const result =
        SR.reconcile(
          local,
          target,
          maxCap
        );

      const delta =
        Number(result?.delta || 0);

      let status = 'ok';

      if (
        result?.action === 'bijboeken' &&
        delta > 0
      ) {
        Core.markRow(tr, {
          action: 'add',
          delta,
          title:
            `Bijboeken ${delta} ` +
            `(target ${target}, remote ${remote})`,
        });

        status = 'bijboeken';
      } else if (
        result?.action === 'uitboeken' &&
        delta > 0
      ) {
        Core.markRow(tr, {
          action: 'remove',
          delta,
          title:
            `Uitboeken ${delta} ` +
            `(target ${target}, remote ${remote})`,
        });

        status = 'uitboeken';
      } else {
        Core.markRow(tr, {
          action: 'none',
          delta: 0,
          title:
            `OK (target ${target}, remote ${remote})`,
        });
      }

      report.push({
        maat,
        local,
        remote,
        target,
        delta,
        status,
      });
    }

    return report;
  }

  function bepaalStatus(
    report,
    stockMap
  ) {
    if (
      !stockMap ||
      stockMap.size === 0
    ) {
      return 'niet-gevonden';
    }

    const differences =
      report.filter(
        (row) =>
          row.status === 'bijboeken' ||
          row.status === 'uitboeken'
      ).length;

    return differences === 0
      ? 'ok'
      : 'afwijking';
  }

  // =========================================================
  // Eén product
  // =========================================================

  function perTableFactory(state) {
    return async function perTable(table) {
      const sku =
        getSkuFromTable(table);

      const label =
        table.querySelector(
          'thead th[colspan]'
        )?.textContent?.trim() ||
        sku ||
        'onbekend';

      const anchorId = sku || label;

      if (!sku) {
        Logger.status(
          anchorId,
          'niet-gevonden'
        );

        Logger.perMaat(
          anchorId,
          []
        );

        return 0;
      }

      Logger.status(
        anchorId,
        'bezig'
      );

      console.info(
        `[VCP2|Naturana] ${sku}: controle gestart.`
      );

      let stockMap =
        readStockCache(sku);

      if (stockMap) {
        console.info(
          `[VCP2|Naturana] ${sku}: voorraad uit korte cache.`
        );
      } else {
        try {
          const result =
            await openArticleViewExact(
              sku,
              state
            );

          stockMap = result.stockMap;

          if (
            !stockMap ||
            stockMap.size === 0
          ) {
            throw new Error(
              'TARGET_NOT_FOUND'
            );
          }

          writeStockCache(
            sku,
            stockMap
          );
        } catch (error) {
          dropStockCache(sku);

          const message =
            String(
              error?.message || error
            );

          console.warn(
            `[VCP2|Naturana] ${sku}: ` +
            'definitief mislukt na retry: ' +
            message
          );

          Logger.status(
            anchorId,
            'niet-gevonden'
          );

          Logger.perMaat(
            anchorId,
            []
          );

          return 0;
        }
      }

      const maxCap =
        getMaxCap(table);

      const localRows =
        readLocalTable(table);

      const report =
        applyCompareAndMark(
          localRows,
          stockMap,
          maxCap
        );

      Logger.status(
        anchorId,
        bepaalStatus(
          report,
          stockMap
        )
      );

      Logger.perMaat(
        anchorId,
        report
      );

      return report.filter(
        (row) =>
          row.status === 'bijboeken' ||
          row.status === 'uitboeken'
      ).length;
    };
  }

  // =========================================================
  // Volledige controle
  // =========================================================

  async function run(button) {
    const tables =
      Array.from(
        document.querySelectorAll(
          '#output table'
        )
      );

    if (!tables.length) {
      console.warn(
        '[VCP2|Naturana] Geen producttabellen gevonden.'
      );

      return;
    }

    if (!bridgeOnline()) {
      button.dataset.skState = 'fail';

      button.title =
        'Naturana-bridge is niet actief';

      alert(
        'Open naturana-online.de in een tabblad, ' +
        'log in en laat dat tabblad open tijdens ' +
        'de controle.'
      );

      return;
    }

    console.info(
      `[VCP2|Naturana] Start controle van ${tables.length} product(en).`
    );

    const state = {
      viewState: null,
      modelIndex: null,
      loadedAt: 0,
    };

    const perTable =
      perTableFactory(state);

    await Core.runTables({
      btn: button,
      tables,
      concurrency: 1,
      perTable,
    });
  }

  // =========================================================
  // Leverancier en knop
  // =========================================================

  function normBlob(value = '') {
    return String(value)
      .toLowerCase()
      .trim()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function isNaturanaSelected() {
    const select =
      $('#leverancier-keuze');

    if (!select) {
      return true;
    }

    const byValue =
      normBlob(select.value || '');

    const byText =
      normBlob(
        select.options?.[
          select.selectedIndex
        ]?.text || ''
      );

    return (
      byValue.includes('naturana') ||
      byText.includes('naturana')
    );
  }

  if (ON_TOOL) {
    registerUserscript();

    const mounted =
      Core.mountSupplierButton({
        id:
          'stock-check-naturana-btn',

        text:
          'Controleer Naturana',

        right: 250,
        top: 8,

        match: () =>
          isNaturanaSelected(),

        onClick: (button) =>
          run(button),
      });

    mounted.btn.innerHTML =
      '<i class="fa-solid fa-magnifying-glass-chart"></i>';

    mounted.btn.setAttribute(
      'aria-label',
      'Controleer voorraad bij Naturana'
    );

    mounted.btn.title =
      'Controleer voorraad bij Naturana';

    installHeartbeatBadge(
      mounted.btn
    );
  }

  if (ON_NATURANA) {
    workerInitBridge();
  }
})();
