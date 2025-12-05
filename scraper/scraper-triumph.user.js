// ==UserScript==
// @name         EAN Scraper | Triumph
// @version      0.8
// @description  Haal stock + EAN uit Triumph/Sloggi B2B grid-API op basis van Supplier PID + maat en vul #tabs-3 in (zonder PHP-bridge).
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @match        https://b2b.triumph.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      b2b.triumph.com
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-triumph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-triumph.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = '[EAN Scraper | Triumph]';

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }
  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }
  function error(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  const HOST = location.hostname;

  // ---------------------------------------------------------------------------
  //  MODE-DETECTIE
  // ---------------------------------------------------------------------------

  if (HOST === 'b2b.triumph.com') {
    installTriumphTokenSniffer();
    return;
  }

  if (HOST === 'www.dutchdesignersoutlet.com') {
    initAdminSide();
    return;
  }

  // Andere hosts: niks doen
  return;

  // ---------------------------------------------------------------------------
  //  Helpers voor webstore/cart extractie
  // ---------------------------------------------------------------------------

  function extractMetaFromUrl(url) {
    if (!url) return {};
    const m = String(url).match(/\/api\/shop\/webstores\/(\d+)\/carts\/(\d+)\//);
    if (!m) return {};
    return {
      webstoreId: m[1],
      cartId: m[2],
    };
  }

  function storeTriumphSession(auth, via, meta) {
    if (!auth) return;
    const token = String(auth).trim();
    if (!/^Bearer\s+/i.test(token)) return;

    let prev = null;
    try {
      const raw = GM_getValue('TriumphBearerToken', null);
      if (raw && typeof raw === 'object') {
        prev = raw;
      }
    } catch (e) {
      // negeren
    }

    const session = {
      auth: token,
      webstoreId: (meta && meta.webstoreId) || (prev && prev.webstoreId) || null,
      cartId: (meta && meta.cartId) || (prev && prev.cartId) || null,
    };

    try {
      GM_setValue('TriumphBearerToken', session);
      log(
        'Session opgeslagen via',
        via,
        '| webstoreId:',
        session.webstoreId || '∅',
        '| cartId:',
        session.cartId || '∅'
      );
    } catch (e) {
      warn('Kon Triumph-session niet opslaan:', e);
    }
  }

  function getTriumphSession() {
    const raw = GM_getValue('TriumphBearerToken', null);
    if (!raw) return null;
    if (typeof raw === 'object') return raw;

    // Oude string-only waarde: alleen auth, geen IDs
    return { auth: String(raw), webstoreId: null, cartId: null };
  }

  // ---------------------------------------------------------------------------
  //  DEEL 1: TOKEN-SNIFFER OP B2B.TRIMUPH.COM
  // ---------------------------------------------------------------------------

  function installTriumphTokenSniffer() {
    log('Token-sniffer actief op Triumph B2B...');

    // 1) fetch patchen
    try {
      const origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function (input, init = {}) {
          try {
            const headers = init && init.headers;
            let auth = null;

            if (headers) {
              if (typeof headers.get === 'function') {
                auth =
                  headers.get('authorization') ||
                  headers.get('Authorization') ||
                  null;
              } else if (Array.isArray(headers)) {
                for (const [k, v] of headers) {
                  if (/^authorization$/i.test(k)) {
                    auth = v;
                    break;
                  }
                }
              } else if (typeof headers === 'object') {
                for (const k of Object.keys(headers)) {
                  if (/^authorization$/i.test(k)) {
                    auth = headers[k];
                    break;
                  }
                }
              }
            }

            if (auth) {
              let urlStr = '';
              if (typeof input === 'string') {
                urlStr = input;
              } else if (input && typeof input.url === 'string') {
                urlStr = input.url;
              }
              const meta = extractMetaFromUrl(urlStr);
              storeTriumphSession(auth, 'fetch', meta);
            }
          } catch (e) {
            warn('Fout in fetch-token-sniffer:', e);
          }
          return origFetch(input, init);
        };
        log('fetch-sniffer geïnstalleerd.');
      }
    } catch (e) {
      warn('Kon fetch niet patchen:', e);
    }

    // 2) XMLHttpRequest patchen
    try {
      const origOpen = XMLHttpRequest.prototype.open;
      const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          this._triUrl = url;
        } catch (e) {
          this._triUrl = '';
        }
        return origOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        try {
          if (/^authorization$/i.test(name)) {
            const meta = extractMetaFromUrl(this._triUrl);
            storeTriumphSession(value, 'XHR', meta);
          }
        } catch (e) {
          warn('Fout in XHR-token-sniffer:', e);
        }
        return origSetHeader.apply(this, arguments);
      };

      log('XMLHttpRequest-sniffer geïnstalleerd.');
    } catch (e) {
      warn('Kon XMLHttpRequest niet patchen:', e);
    }

    log(
      'Ga gewoon de B2B gebruiken (product openen etc.); ' +
        'het script pikt token + webstoreId + cartId automatisch op.'
    );
  }

  // ---------------------------------------------------------------------------
  //  DEEL 2: ADMIN-SIDE EAN + STOCK SCRAPER
  // ---------------------------------------------------------------------------

  function initAdminSide() {
    const BTN_ID = 'triumph-stock-ean-scraper-btn';
    const TABLE_SELECTOR = '#tabs-3 table.options';
    const PID_SELECTOR = '#tabs-1 input[name="supplier_pid"]';
    const BRAND_TITLE_SELECTOR = '#tabs-1 #select2-brand-container';

    const $ = (s, r = document) => r.querySelector(s);

    // --- helpers -------------------------------------------------------------

    function getBrandTitle() {
      const c = document.querySelector(BRAND_TITLE_SELECTOR);
      const title = c?.getAttribute('title') || c?.textContent || '';
      const selectText =
        document.querySelector('#tabs-1 select[name="brand"] option:checked')
          ?.textContent || '';
      return (title || selectText || '').replace(/\u00A0/g, ' ').trim();
    }

    function isSupportedBrand() {
      const title = getBrandTitle().toLowerCase();
      if (!title) return false;
      return title.includes('triumph') || title.includes('sloggi');
    }

    function hasTable() {
      return !!document.querySelector(TABLE_SELECTOR);
    }

    // vergelijkbaar met Anita-script
    function isTab3Active() {
      const activeByHeader = document.querySelector(
        '#tabs .ui-tabs-active a[href="#tabs-3"], ' +
          '#tabs .active a[href="#tabs-3"], ' +
          '#tabs li.current a[href="#tabs-3"]'
      );
      if (activeByHeader) return true;

      const panel = document.querySelector('#tabs-3');
      if (!panel) return false;
      const style = getComputedStyle(panel);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.height !== '0px'
      );
    }

    function normalizeLocalSize(s) {
      return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
    }

    const SIZE_MAP_EU_TO_ALPHA = {
      '3': 'XS',
      '4': 'S',
      '5': 'M',
      '6': 'L',
      '7': 'XL',
      '8': 'XXL',
    };

    function normalizeTriumphSizeLabel(s) {
      return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
    }

    function mapQtyToStockLevel(qty) {
      const n = Number(qty ?? 0) || 0;
      if (n <= 2) return 1;
      if (n === 3) return 2;
      if (n === 4) return 3;
      return 5;
    }

    function splitSupplierPid(rawPid) {
      const pid = String(rawPid || '').trim();
      if (!pid) return null;
      const idx = pid.lastIndexOf('-');
      if (idx === -1) return null;
      return {
        base: pid.slice(0, idx),
        color: pid.slice(idx + 1),
      };
    }

    function buildGridUrlFromPidBase(base) {
      if (!base) return null;

      const session = getTriumphSession();
      if (!session || !session.webstoreId || !session.cartId) {
        warn(
          'Geen geldige Triumph-session (webstoreId/cartId ontbreken). ' +
            'Open b2b.triumph.com en laat een grid-call lopen.'
        );
        return null;
      }

      return (
        `https://b2b.triumph.com/api/shop/webstores/${encodeURIComponent(
          session.webstoreId
        )}` +
        `/carts/${encodeURIComponent(session.cartId)}/grid/` +
        encodeURIComponent(String(base)) +
        '/products'
      );
    }

    function gmGetTriumphGrid(gridUrl, cb) {
      const session = getTriumphSession();
      if (!session || !session.auth) {
        cb(
          new Error(
            'Geen Triumph-auth gevonden. ' +
              'Open eerst b2b.triumph.com (met dit script actief) zodat token + IDs kunnen worden opgepikt.'
          ),
          null
        );
        return;
      }
      if (!session.webstoreId || !session.cartId) {
        cb(
          new Error(
            'Triumph-session mist webstoreId of cartId. ' +
              'Open een product op b2b.triumph.com zodat een grid-call loopt.'
          ),
          null
        );
        return;
      }

      const bearer = session.auth;

      log('GET grid via GM_xmlhttpRequest:', gridUrl);

      GM_xmlhttpRequest({
        method: 'GET',
        url: gridUrl,
        headers: {
          Accept: 'application/json, text/plain, */*',
          Authorization: bearer,
        },
        onload: resp => {
          if (resp.status < 200 || resp.status >= 300) {
            cb(new Error('HTTP ' + resp.status + ' bij ophalen grid'), null);
            return;
          }
          let data;
          try {
            data = JSON.parse(resp.responseText);
          } catch (e) {
            cb(
              new Error('JSON parse-fout op Triumph grid-respons: ' + e.message),
              null
            );
            return;
          }
          cb(null, data);
        },
        onerror: err => {
          cb(err || new Error('Netwerkfout Triumph grid'), null);
        },
      });
    }

    /**
     * Triumph grid-JSON → Map('75B' -> { qty, ean })
     */
    function buildSizesMapFromGridJson(json, colorCodeFromPid) {
      const map = new Map();
      if (!json) return map;

      let products;
      if (Array.isArray(json)) {
        products = json;
      } else if (Array.isArray(json.products)) {
        products = json.products;
      } else {
        warn('Onbekende grid-JSON structuur, verwacht array of { products: [] }');
        return map;
      }

      if (!products || !products.length) {
        warn('Geen producten in grid-JSON (lege products-array)');
        return map;
      }

      const colorNorm = String(colorCodeFromPid || '').trim().toUpperCase();
      let product = null;

      if (colorNorm) {
        product = products.find(p => {
          const u1 = String(p.userDefinedField1 || '').trim().toUpperCase();
          const cc = String(p.colorCode || '').trim().toUpperCase();
          return u1 === colorNorm || cc === colorNorm;
        });
      }

      if (!product) {
        if (products.length === 1) {
          product = products[0];
          warn(
            'Geen exacte kleur-match voor',
            colorNorm,
            '→ val terug op enige product:',
            {
              userDefinedField1: product.userDefinedField1,
              colorCode: product.colorCode,
              simpleColor: product.simpleColor,
            }
          );
        } else {
          warn(
            'Geen product-match voor kleur',
            colorNorm,
            'Beschikbare kleuren:',
            products.map(p => ({
              userDefinedField1: p.userDefinedField1,
              colorCode: p.colorCode,
              simpleColor: p.simpleColor,
            }))
          );
          product = products[0];
        }
      }

      const skus = Array.isArray(product.skus) ? product.skus : [];
      log(
        'Gekozen product voor kleur',
        colorNorm,
        '→ styleCode:',
        product.styleCode,
        'simpleColor:',
        product.simpleColor,
        'userDefinedField1:',
        product.userDefinedField1,
        'colorCode:',
        product.colorCode,
        'aantal skus:',
        skus.length
      );

      for (const sku of skus) {
        const rawBand = String(sku.sizeName || sku.sizeDisplayName || '').trim();
        const rawCup  = String(sku.subSizeName || sku.subSizeDisplayName || '').trim();

        let sizeLabel = '';

        if (!rawBand && !rawCup) continue;

        if (!rawCup) {
          if (rawBand === '1') {
            sizeLabel = 'One Size';
          } else if (rawBand === '2') {
            sizeLabel = 'Two Size';
          } else if (SIZE_MAP_EU_TO_ALPHA[rawBand]) {
            sizeLabel = SIZE_MAP_EU_TO_ALPHA[rawBand];
          } else {
            sizeLabel = rawBand;
          }
        } else {
          sizeLabel = (rawBand + rawCup).trim();
        }

        if (!sizeLabel) continue;

        const eanRaw = String(sku.eanCode || sku.gtin || '').replace(/\D/g, '');
        if (!eanRaw) continue;

        let qty = 0;
        if (Array.isArray(sku.stockLevels) && sku.stockLevels.length) {
          const lvl = sku.stockLevels[0];
          qty =
            Number(
              lvl.quantity ??
                lvl.available ??
                lvl.qty ??
                0
            ) || 0;
        }

        const sizeNorm = normalizeTriumphSizeLabel(sizeLabel);
        if (!sizeNorm) continue;

        const existing = map.get(sizeNorm);
        if (!existing || existing.qty < qty) {
          map.set(sizeNorm, { qty, ean: eanRaw });
        }
      }

      log('Uiteindelijke map-grootte:', map.size);
      console.debug(LOG_PREFIX, 'Keys in map:', Array.from(map.keys()));
      return map;
    }

    // --- Button UI -----------------------------------------------------------

    function setBtnState(opts = {}) {
      const btn = document.getElementById(BTN_ID);
      if (!btn) return;
      if (opts.text != null) btn.textContent = opts.text;
      if (opts.bg != null) btn.style.backgroundColor = opts.bg;
      if (opts.disabled != null) btn.disabled = !!opts.disabled;
      if (opts.opacity != null) btn.style.opacity = String(opts.opacity);
    }

    function updateButtonVisibility(btn) {
      if (!btn) return;
      const okBrand = isSupportedBrand();
      const tableReady = hasTable();
      const active = isTab3Active();

      if (okBrand && active) {
        btn.style.display = '';
      } else {
        btn.style.display = 'none';
      }

      btn.disabled = !tableReady;
      btn.style.opacity = tableReady ? '1' : '.55';

      if (!okBrand) {
        btn.title = 'Selecteer een merk Triumph of Sloggi op tab 1.';
      } else if (!active) {
        btn.title = 'Ga naar het tabblad met de maten (#tabs-3).';
      } else if (!tableReady) {
        btn.title = 'Wachten tot #tabs-3 geladen is...';
      } else {
        btn.title =
          'Haal stock + EAN uit Triumph/Sloggi grid-API en plak in #tabs-3';
      }
    }

    function resetBtn() {
      const btn = document.getElementById(BTN_ID);
      if (!btn) return;
      setBtnState({
        text: '⛏️ SS&E | Triumph/Sloggi',
        bg: '#007cba',
        disabled: false,
        opacity: '1',
      });
      updateButtonVisibility(btn);
    }

    function ensureButton() {
      if (!document.body) return;

      let btn = document.getElementById(BTN_ID);
      if (!btn) {
        btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.textContent = '⛏️ SS&E | Triumph/Sloggi';
        btn.style.cssText = `
          position: fixed;
          right: 10px;
          top: 10px;
          z-index: 999999;
          padding: 10px 12px;
          background: #007cba;
          color: #fff;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,.15);
          font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        `;
        document.body.appendChild(btn);
        btn.addEventListener('click', onScrapeClick);
      }

      updateButtonVisibility(btn);
    }

    // --- Hoofdactie ----------------------------------------------------------

    function onScrapeClick() {
      const btn = document.getElementById(BTN_ID);
      if (!btn || btn.disabled) return;

      if (!isSupportedBrand()) {
        setBtnState({
          text: '❌ Merk niet ondersteund',
          bg: '#e06666',
        });
        setTimeout(resetBtn, 2500);
        return;
      }

      if (!isTab3Active()) {
        setBtnState({
          text: '❌ Open tab Maten/Opties',
          bg: '#e06666',
        });
        setTimeout(resetBtn, 2500);
        return;
      }

      const supplierPid = $(PID_SELECTOR)?.value?.trim();
      if (!supplierPid) {
        setBtnState({
          text: '❌ Geen Supplier PID',
          bg: '#e06666',
        });
        setTimeout(resetBtn, 2500);
        return;
      }

      const pidParts = splitSupplierPid(supplierPid);
      if (!pidParts) {
        warn('Onverwacht PID-formaat:', supplierPid);
        setBtnState({
          text: '❌ PID-formaat onbekend',
          bg: '#e06666',
        });
        setTimeout(resetBtn, 2500);
        return;
      }

      const gridUrl = buildGridUrlFromPidBase(pidParts.base);
      if (!gridUrl) {
        setBtnState({
          text: '❌ Geen grid-URL (session mist IDs)',
          bg: '#e06666',
        });
        setTimeout(resetBtn, 2500);
        return;
      }

      log('Supplier PID:', supplierPid, '→ grid URL:', gridUrl);

      setBtnState({
        text: '⏳ Grid laden...',
        bg: '#f1c40f',
        disabled: true,
        opacity: '.8',
      });

      gmGetTriumphGrid(gridUrl, (err, data) => {
        if (err || !data) {
          error('Fout bij ophalen grid:', err);
          setBtnState({
            text: '❌ Grid niet geladen',
            bg: '#e06666',
            disabled: false,
            opacity: '1',
          });
          setTimeout(resetBtn, 2500);
          return;
        }

        handleTriumphData(data, pidParts.color);
      });
    }

    function handleTriumphData(json, colorCode) {
      const sizesMap = buildSizesMapFromGridJson(json, colorCode);
      if (!sizesMap || sizesMap.size === 0) {
        setBtnState({
          text: '❌ Geen maten in grid-data',
          bg: '#e06666',
        });
        setTimeout(resetBtn, 2500);
        return;
      }

      const table = document.querySelector(TABLE_SELECTOR);
      if (!table) {
        setBtnState({
          text: '❌ #tabs-3 niet klaar',
          bg: '#e06666',
        });
        setTimeout(resetBtn, 2500);
        return;
      }

      const rows = table.querySelectorAll('tbody tr');
      let matched = 0;

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) return;

        const sizeInput = cells[0].querySelector('input.product_option_small');
        const sizeRaw = sizeInput ? sizeInput.value : '';
        const sizeNorm = normalizeLocalSize(sizeRaw);
        if (!sizeNorm) return;

        const entry = sizesMap.get(sizeNorm);
        if (!entry) return;

        const { qty, ean } = entry;
        const stockMapped = mapQtyToStockLevel(qty);

        const stockInput = row.querySelector(
          'input[name^="options"][name$="[stock]"]'
        );
        const eanInput = row.querySelector(
          'input[name^="options"][name$="[barcode]"]'
        );

        if (stockInput) {
          stockInput.value = String(stockMapped);
          stockInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        if (eanInput && ean) {
          eanInput.value = String(ean);
          eanInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        matched++;
      });

      log(`${matched} rijen ingevuld uit grid-API`);
      setBtnState({
        text: `📦 ${matched} rijen gevuld`,
        bg: '#2ecc71',
        disabled: false,
        opacity: '1',
      });
      setTimeout(resetBtn, 2500);
    }

    // --- Observer + lifecycle -----------------------------------------------

    const observer = new MutationObserver(() => {
      scheduleEnsureButton();
    });

    let ensureScheduled = false;

    function scheduleEnsureButton() {
      if (ensureScheduled) return;
      ensureScheduled = true;

      setTimeout(() => {
        ensureScheduled = false;
        ensureButton();

        const btn = document.getElementById(BTN_ID);
        if (btn && hasTable()) {
          try {
            observer.disconnect();
            log('Observer gestopt: button + tabel gevonden.');
          } catch (e) {
            warn('Kon observer niet disconnecten:', e);
          }
        }
      }, 100);
    }

    function startObserver() {
      const root = document.documentElement || document.body;
      if (!root) {
        warn('Geen root-node voor MutationObserver');
        return;
      }
      try {
        observer.observe(root, {
          childList: true,
          subtree: true,
        });
      } catch (e) {
        warn('MutationObserver fout:', e);
      }
    }

    window.addEventListener('pageshow', scheduleEnsureButton);
    window.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleEnsureButton();
    });
    window.addEventListener('hashchange', scheduleEnsureButton);
    window.addEventListener('popstate', scheduleEnsureButton);

    ensureButton();
    startObserver();
  }
})();
