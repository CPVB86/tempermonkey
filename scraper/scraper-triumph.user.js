// ==UserScript==
// @name         EAN Scraper | Triumph
// @version      0.5
// @description  Haal stock + EAN uit Triumph/Sloggi B2B grid-API op basis van Supplier PID + maat en vul #tabs-3 in (zonder PHP-bridge).
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @match        https://lingerieoutlet.nl/admin.php?section=products*
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
    // We zitten op Triumph B2B → token-sniffer installeren
    installTriumphTokenSniffer();
    return;
  }

  if (
    HOST === 'www.dutchdesignersoutlet.com' ||
    HOST === 'lingerieoutlet.nl'
  ) {
    // We zitten in jouw admin → EAN/stock-scraper UI + logica
    initAdminSide();
    return;
  }

  // Andere hosts: niks doen
  return;

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
                  if (/^authorization$/i.test(k) && String(v).startsWith('Bearer ')) {
                    auth = v;
                    break;
                  }
                }
              } else if (typeof headers === 'object') {
                for (const k of Object.keys(headers)) {
                  if (/^authorization$/i.test(k) && String(headers[k]).startsWith('Bearer ')) {
                    auth = headers[k];
                    break;
                  }
                }
              }
            }

            if (auth && auth.startsWith('Bearer ')) {
              GM_setValue('TriumphBearerToken', auth);
              log('Bearer-token (fetch) opgeslagen in GM_setValue.');
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
          this._isTriumphApi =
            typeof url === 'string' &&
            url.indexOf('/api/shop/webstores/') !== -1;
        } catch (e) {
          this._isTriumphApi = false;
        }
        return origOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        try {
          if (
            this._isTriumphApi &&
            /^authorization$/i.test(name) &&
            String(value).startsWith('Bearer ')
          ) {
            GM_setValue('TriumphBearerToken', String(value));
            log('Bearer-token (XHR) opgeslagen in GM_setValue.');
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
        'het script pikt het Authorization: Bearer token automatisch op.'
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

    // Triumph / Sloggi grid-API waardes
    const TRIUMPH_WEBSTORE_ID = '2442';
    const TRIUMPH_CART_ID = '2155706';

    const SLOGGI_WEBSTORE_ID = '2442';
    const SLOGGI_CART_ID = '2383370';

    const $ = (s, r = document) => r.querySelector(s);

    const getBrandTitle = () =>
      document.querySelector(BRAND_TITLE_SELECTOR)?.title?.trim() || '';

    // Button tonen voor zowel Triumph als Sloggi
    function isSupportedBrand() {
      const title = getBrandTitle().toLowerCase();
      if (!title) return true; // liever tonen dan verstoppen
      return title.includes('triumph') || title.includes('sloggi');
    }

    // Bepaal welke cart/webstore er hoort bij de huidige brand
    function getBrandConfig() {
      const title = getBrandTitle().toLowerCase();

      if (title.includes('sloggi')) {
        return {
          brand: 'sloggi',
          webstoreId: SLOGGI_WEBSTORE_ID,
          cartId: SLOGGI_CART_ID,
        };
      }

      // default: Triumph
      return {
        brand: 'triumph',
        webstoreId: TRIUMPH_WEBSTORE_ID,
        cartId: TRIUMPH_CART_ID,
      };
    }

    function hasTable() {
      return !!document.querySelector(TABLE_SELECTOR);
    }

    function normalizeLocalSize(s) {
      return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
    }

    // Mapping van Triumph EU-codes naar alpha-maten
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

    // Supplier PID: "10162782-0004"
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

    // Grid-URL voor een stylecode, met juiste cart per merk
    function buildGridUrlFromPidBase(base) {
      if (!base) return null;
      const cfg = getBrandConfig();
      return (
        `https://b2b.triumph.com/api/shop/webstores/${cfg.webstoreId}` +
        `/carts/${cfg.cartId}/grid/` +
        encodeURIComponent(String(base)) +
        '/products'
      );
    }

    // --- Triumph API call met Bearer ----------------------------------------

    function gmGetTriumphGrid(gridUrl, cb) {
      const bearer = GM_getValue('TriumphBearerToken', '');
      if (!bearer) {
        cb(
          new Error(
            'Geen Triumph Bearer-token gevonden. ' +
              'Open eerst b2b.triumph.com (met dit script actief) zodat het token kan worden opgepikt.'
          ),
          null
        );
        return;
      }

      log('GET grid via GM_xmlhttpRequest:', gridUrl);

      GM_xmlhttpRequest({
        method: 'GET',
        url: gridUrl,
        headers: {
          Accept: 'application/json, text/plain, */*',
          Authorization: bearer,
        },
        onload: (resp) => {
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
        onerror: (err) => {
          cb(err || new Error('Netwerkfout Triumph grid'), null);
        },
      });
    }

    // --- (optionele) kleurcode → kleurnaam mapping -------------------------

    const TRIUMPH_COLOR_MAP_DEFAULT = {
      '0004': 'BLACK',
      '6106': 'SMOOTH SKIN',
      '0003': 'WHITE',
      '00GT': 'VANILLE',
      '0034': 'BLACK COMBINATION',
      '0080': 'NIGHT BLUE',
      '1196': 'ORANGE HIGHLIGHT',
      '00NZ': 'NUDE BEIGE',
      '00CM': 'NOSTALGIC BROWN',
      '00GZ': 'SILK WHITE',
      '1141': 'CACAO',
      '00EP': 'NEUTRAL BEIGE',
      '00RA': 'NAVY',
      '6720': 'CREAMY DREAM',
      '1595': 'ECRU WHITE',
      '00UD': 'ROSE BROWN',
      '0026': 'SKIN',
      '00ZE': 'CHOCOLATE MOUSSE',
      '00VV': 'FIG PINK',
      '2114': 'NAVY BLUE',
      '00ED': 'PAPRIKA RED',
      '7311': 'PROVINCIAL BLUE',
      '6312': 'DEEP COBALT',
      '3780': 'GREY',
      '7539': 'PROVENCE',
      '7731': 'TOPAZ',
      '7080': 'NECTARINE',
      '00DK': 'PEBBLE GREY',
      '1786': 'RUSSIAN GREEN',
      '6437': 'MYSTIC PLUM',
      '0093': 'CHILI',
      '7008': 'RED WOOD',
      'M013': 'GREY COMBINATION',
      '0038': 'CHRYSANTHEME',
      '0032': 'BLUE COMBINATION',
      'M017': 'ORANGE - LIGHT COMBINATION',
      '00PQ': 'CORAL',
      '7014': 'RUST',
      '3811': 'VIOLET',
      '7786': 'SILKY GREEN',
      '6308': 'ANGORA',
      '00ME': 'CAMEO BROWN',
      '00FU': 'PLATINUM',
      '3649': 'PEROLA',
      '6315': 'CHAMBRAY',
      '7574': 'LILA CLOVER',
      '00FZ': 'SHANGHAI RED',
    };

    const TRIUMPH_COLOR_MAP_KEY = 'triumph_color_map_dynamic';

    function loadColorMap() {
      try {
        const raw = GM_getValue(TRIUMPH_COLOR_MAP_KEY, '{}');
        const obj = JSON.parse(raw);
        return obj && typeof obj === 'object' ? obj : {};
      } catch (e) {
        console.warn(LOG_PREFIX, 'Kon kleurmap niet laden, fallback naar {}', e);
        return {};
      }
    }

    function saveColorMap(map) {
      try {
        GM_setValue(TRIUMPH_COLOR_MAP_KEY, JSON.stringify(map || {}));
      } catch (e) {
        console.warn(LOG_PREFIX, 'Kon kleurmap niet opslaan', e);
      }
    }

    function resolveColorNameForCode(code) {
      const codeNorm = String(code || '').trim().toUpperCase();
      if (!codeNorm) return null;

      const stored = loadColorMap();

      // 1) Dynamisch (eerder ingevuld)
      if (stored[codeNorm]) return stored[codeNorm];

      // 2) Statisch default
      if (TRIUMPH_COLOR_MAP_DEFAULT[codeNorm]) {
        return TRIUMPH_COLOR_MAP_DEFAULT[codeNorm];
      }

      // 3) Onbekende kleurcode → vragen
      const userVal = window.prompt(
        `${LOG_PREFIX}\nOnbekende Triumph kleurcode: ${codeNorm}\n` +
          'Voer de kleurnaam in zoals in de B2B-grid staat (bijv. WHITE / BLACK / GREY):',
        ''
      );

      if (userVal && userVal.trim()) {
        const val = userVal.trim().toUpperCase();
        stored[codeNorm] = val;
        saveColorMap(stored);
        console.info(
          LOG_PREFIX,
          'Nieuwe kleurcode mapping opgeslagen:',
          codeNorm,
          '→',
          val
        );
        return val;
      }

      console.warn(LOG_PREFIX, 'Geen mapping opgegeven voor kleurcode', codeNorm);
      return null;
    }

    /**
     * Triumph grid-JSON → Map('75B' -> { qty, ean })
     * json: response van /grid/{styleCode}/products
     * colorCodeFromPid: bv. '0004' uit Supplier PID 10162782-0004
     */
    function buildSizesMapFromGridJson(json, colorCodeFromPid) {
      const map = new Map();
      if (!json) return map;

      // 1) Productenlijst bepalen
      let products;
      if (Array.isArray(json)) {
        products = json;
      } else if (Array.isArray(json.products)) {
        products = json.products;
      } else {
        warn(
          'Onbekende grid-JSON structuur, verwacht array of { products: [] }'
        );
        return map;
      }

      if (!products || !products.length) {
        warn('Geen producten in grid-JSON (lege products-array)');
        return map;
      }

      const colorNorm = String(colorCodeFromPid || '').trim().toUpperCase();
      let product = null;

      if (colorNorm) {
        const colorName = resolveColorNameForCode(colorNorm);
        product = products.find((p) => {
          const u1 = String(p.userDefinedField1 || '').trim().toUpperCase();
          const cc = String(p.colorCode || '').trim().toUpperCase();
          const sc = String(p.simpleColor || '').trim().toUpperCase();

          if (u1 === colorNorm || cc === colorNorm) return true;
          if (colorName && sc === colorName) return true;
          return false;
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
            products.map((p) => ({
              userDefinedField1: p.userDefinedField1,
              colorCode: p.colorCode,
              simpleColor: p.simpleColor,
            }))
          );
          // Als je hier NIET wilt vallen op eerste product, dan gewoon "return map;" doen.
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

// 3) Per SKU maat + EAN + voorraad mappen
for (const sku of skus) {
  const rawBand = String(
    sku.sizeName || sku.sizeDisplayName || ''
  ).trim();
  const rawCup = String(
    sku.subSizeName || sku.subSizeDisplayName || ''
  ).trim();

  // --- Maatmapping: Triumph → jouw systeem ---
  // Cases:
  // - Alleen band = "1"       → One Size
  // - Alleen band = "2"       → Two Size
  // - Alleen band = "3"–"8"   → XS–XXL
  // - Anders: band + cup (75 + B → 75B)
  let sizeLabel = '';

  if (!rawBand && !rawCup) continue;

  if (!rawCup) {
    // Eén-dimensionale maten (slips, tops, etc.)
    if (rawBand === '1') {
      // Triumph-code "1" is bij jou "One Size"
      sizeLabel = 'One Size';
    } else if (rawBand === '2') {
      // Triumph-code "2" is bij jou "Two Size"
      sizeLabel = 'Two Size';
    } else if ( SIZE_MAP_EU_TO_ALPHA[rawBand] ) {
      // EU-maatnummers 3–8 omzetten naar XS–XXL
      sizeLabel = SIZE_MAP_EU_TO_ALPHA[rawBand];
    } else {
      // Onbekende / al alfabetische maat (bv. 'S', 'M', 'L')
      sizeLabel = rawBand;
    }
  } else {
    // Bh-maten of andere band+cup combinaties
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

    function resetBtn() {
      const tableReady = hasTable() && isSupportedBrand();
      setBtnState({
        text: '📦 Triumph/Sloggi stock + EAN',
        bg: '#c0392b',
        disabled: !tableReady,
        opacity: tableReady ? '1' : '.55',
      });
    }

    function ensureButton() {
      if (!document.body) return;

      let btn = document.getElementById(BTN_ID);
      if (!btn) {
        btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.textContent = '📦 Triumph/Sloggi stock + EAN';
        btn.style.cssText = `
          position: fixed;
          right: 10px;
          top: 120px;
          z-index: 999999;
          padding: 10px 12px;
          background: #c0392b;
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

      const okBrand = isSupportedBrand();
      const tableReady = hasTable();

      btn.style.display = okBrand ? '' : 'none';
      btn.disabled = !tableReady;
      btn.style.opacity = tableReady ? '1' : '.55';
      btn.title = tableReady
        ? 'Haal stock + EAN uit Triumph/Sloggi grid-API en plak in #tabs-3'
        : 'Wachten tot #tabs-3 geladen is...';
    }

    // --- Hoofdactie ----------------------------------------------------------

    function onScrapeClick() {
      const btn = document.getElementById(BTN_ID);
      if (!btn || btn.disabled) return;

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
          text: '❌ Geen grid-URL',
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

      rows.forEach((row) => {
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

    const observer = new MutationObserver(() => ensureButton());

    function startObserver() {
      try {
        observer.observe(document.documentElement || document.body, {
          childList: true,
          subtree: true,
        });
      } catch (e) {
        warn('MutationObserver fout:', e);
      }
    }

    window.addEventListener('pageshow', ensureButton);
    window.addEventListener('visibilitychange', () => {
      if (!document.hidden) ensureButton();
    });
    window.addEventListener('hashchange', ensureButton);
    window.addEventListener('popstate', ensureButton);

    ensureButton();
    startObserver();
  }
})();
