// ==UserScript==
// @name DDO Toolbox | EDI | Lisca
// @namespace https://dutchdesignersoutlet.nl/
// @version 2.0.4
// @description Lisca EDI: modelcheck, product, maten, EAN, foto's en bestaande DDO-sheetkoppeling.
// @match https://b2b-eu.lisca.com/*
// @match https://www.dutchdesignersoutlet.com/admin.php*
// @grant GM_xmlhttpRequest
// @grant GM_setClipboard
// @grant GM_download
// @connect b2b-eu.lisca.com
// @connect www.dutchdesignersoutlet.com
// @connect dutchdesignersoutlet.com
// @connect docs.google.com
// @connect googleusercontent.com
// @connect *.googleusercontent.com
// @require https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at document-idle
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-lisca.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-lisca.user.js
// ==/UserScript==
(() => {
'use strict';
// BEGIN SHARED EDI (generated; edit EDI/shared.js)
// Shared EDI contract. Bundled into userscripts by build-edi.cjs.
const DDO_EDI = (() => {
  function normalizeSize(value) {
    let size = String(value ?? '').toUpperCase().replace(/\(.*?\)/g, '').replace(/\s+/g, '');
    size = ({'XL/2L':'XL/XXL','XL/2XL':'XL/XXL','3L/4L':'3XL/4XL'})[size] || size;
    return size.replace(/\b([2-5])XL\b/g, (_, n) => 'X'.repeat(Number(n)) + 'L');
  }
  function sizeCandidates(value) {
    const size = normalizeSize(value), match = size.match(/^(X{2,5})L$/);
    return match ? [size, `${match[1].length}XL`] : [size];
  }
  function parseEAN(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('input[type="password"]')) throw Error('Log eerst in bij LingaDore B2B');
    const values = new Set();
    for (const row of doc.querySelectorAll('tr')) {
      const label = row.querySelector('th,td');
      if (!/\bean\b/i.test(label?.textContent || '')) continue;
      const value = label.nextElementSibling?.textContent?.trim() || '';
      if (/^\d{8,14}$/.test(value)) values.add(value);
    }
    if (values.size > 1) throw Error('Meerdere EAN-codes voor één variant');
    return [...values][0] || '';
  }
  function variantMap(entries) {
    const map = new Map();
    for (const entry of entries) {
      const size = normalizeSize(entry.size), ean = String(entry.ean || '');
      if (!size || !/^\d{8,14}$/.test(ean)) throw Error('Ongeldige maat/EAN-regel');
      if (map.has(size) && map.get(size).ean !== ean) throw Error(`Conflicterende EAN voor ${size}`);
      map.set(size, {...entry, size, ean});
    }
    return map;
  }
  function eanTSV(entries, supplierId) {
    if (/[\t\r\n]/.test(supplierId)) throw Error('Ongeldig Supplier ID');
    return [...variantMap(entries).values()].map(e => `${e.size}\t${e.ean}\t${supplierId}`).join('\n');
  }
  const productClipboard = payload => `<!--SPARKLE:${JSON.stringify(payload)}-->`;
  const sizesClipboard = (source, supplierId, sizes) => JSON.stringify({source, orderId:false, supplierId, sizes:[...new Set(sizes.map(normalizeSize))]}, null, 2);
  const theme = `
    #edi-lingadore{background:#fff;color:#25313b;border:1px solid #cbd5df;border-radius:7px;box-shadow:0 5px 18px #0002;font:12px/1.25 system-ui}
    #edi-lingadore [hidden]{display:none!important}
    #edi-lingadore .edi-head{min-height:28px;padding:0 8px;background:#263746;color:#fff;border:0;touch-action:none}
    #edi-lingadore .edi-version{font-size:9px;color:#fff}
    #edi-lingadore .edi-icon-btn{color:#fff;border-radius:4px}
    #edi-lingadore .edi-icon-btn:hover{background:#ffffff22}
    #edi-lingadore .edi-btn,#edi-lingadore .edi-action{border:0;border-radius:4px;background:#0877b9;color:#fff;font:600 11px/1.15 system-ui;min-height:27px;padding:4px 7px}
    #edi-lingadore .edi-btn:hover:not(:disabled),#edi-lingadore .edi-action:hover:not(:disabled){background:#18864b;color:#fff}
    #edi-lingadore .edi-danger{background:#c83939}
    #edi-lingadore button:disabled{background:#d6dce1;color:#7b858d;opacity:1;cursor:not-allowed}
    #edi-lingadore .edi-status{background:#f4f7f9;color:#56616a;border-radius:4px;font-size:10px}
    #edi-lingadore .edi-match-ok{color:#18864b}
    #edi-lingadore .edi-match-miss{color:#c83939}
    #edi-lingadore .edi-body{max-height:calc(100vh - 65px);overflow:auto}
  `;
  const isCartPage = () => /(?:^|\/)(?:cart|basket|winkelwagentje|winkelwagen|shopping-?cart|shopping-?basket)(?:\/|$)/i.test(location.pathname);
  // One supplier-panel layout, based on LingaDore. Applied after supplier CSS.
  const layout = `
    #edi-lingadore [hidden]{display:none!important}
    #edi-lingadore .edi-head{min-height:28px;padding:0 8px;gap:8px}
    #edi-lingadore .edi-title{display:flex;align-items:center;gap:8px;font-weight:700;flex:1;min-width:0}
    #edi-lingadore .edi-version{font-size:9px;font-weight:400;flex:none}
    #edi-lingadore .edi-icon-btn{width:26px!important;min-height:26px;padding:0;font:14px/26px system-ui;background:transparent;border:0;flex:none}
    #edi-lingadore .edi-body{padding:10px}
    #edi-lingadore .edi-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:8px}
    #edi-lingadore .edi-status{min-height:24px;padding:5px 7px;margin-bottom:8px;font-size:10px}
    #edi-lingadore .edi-pdp-meta{display:flex;align-items:baseline;gap:6px;margin:0 0 8px;font-size:12px;font-weight:400;color:#5f6368}
    #edi-lingadore .edi-pdp-meta strong{color:#202124;font-weight:400}
    #edi-lingadore .edi-summary{color:#5f6368;font-size:11px;margin:-2px 0 8px}
    #edi-lingadore .edi-colors{display:flex;flex-direction:column;gap:4px}
    #edi-lingadore .edi-color-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px;min-height:34px;padding:3px 4px;border:1px solid #e3e6e8;border-radius:7px;background:#f8f9fa}
    #edi-lingadore .edi-color-row.edi-active{background:#f8f9fa;border-color:#e3e6e8}
    #edi-lingadore .edi-color-main{display:flex;flex-direction:row;align-items:center;flex-wrap:nowrap;min-width:0;gap:7px;font-size:11px}
    #edi-lingadore .edi-color-select{display:flex;align-items:center;gap:7px;min-width:0;padding:2px 0;border:0;background:transparent;text-align:left;color:#202124}
    #edi-lingadore .edi-swatch{width:17px;height:17px;flex:0 0 17px;border-radius:50%;border:1px solid #0003;background:#e5e7eb}
    #edi-lingadore .edi-color-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400}
    #edi-lingadore .edi-match{margin-left:auto;font-size:10px;white-space:nowrap;flex:none}
    #edi-lingadore .edi-match a{color:inherit;text-decoration:none}
    #edi-lingadore .edi-actions{display:flex;gap:3px;flex-wrap:nowrap}
    #edi-lingadore details.edi-module{border:0;margin:0;padding:0}
    #edi-lingadore details.edi-module+details.edi-module{border-top:1px solid #dfe5e9;margin-top:8px;padding-top:8px}
    #edi-lingadore .edi-module>summary{cursor:pointer;font-size:12px;font-weight:600;margin:0 0 8px;padding:0}
    #edi-lingadore .edi-module-note{font-size:11px;line-height:1.4;margin:0;color:#5f6368}
  `;
  return {normalizeSize, sizeCandidates, parseEAN, variantMap, eanTSV, productClipboard, sizesClipboard, theme, layout, isCartPage};
})();

// END SHARED EDI
// Product extraction adapted from supplied Sparkle Lisca 2.5.0.
const LISCA_PRODUCT = (document, url, html, colorLabel = '') => {
 const location={href:url}, MARKUP_FACTOR=2.5, SUPPLIER_NAME='Lisca';
 const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
 const normalizeSku=s=>String(s||'').includes('-')?String(s).trim():String(s||'').slice(0,6)+'-'+String(s||'').slice(6);
  function toTitleCase(s = '') {
    return String(s || '')
      .replace(/[»«]/g, '')
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }
  function parsePriceText(txt = '') {
    const cleaned =
      String(txt || '')
        .replace(/\s+/g, ' ')
        .replace(/[^\d,.]/g, '')
        .trim();
    if (!cleaned) {
      return NaN;
    }
    const n =
      parseFloat(
        cleaned.replace(',', '.')
      );
    return Number.isFinite(n)
      ? n
      : NaN;
  }
  function fmtMoney(n) {
    return Number.isFinite(n)
      ? n.toFixed(2)
      : '';
  }
  function escapeRegex(s = '') {
    return String(s).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );
  }
  function isValidEan(ean) {
    return /^\d{8,14}$/.test(
      String(ean ?? '').trim()
    );
  }
  function pickDescription() {
    const candidates = [
      '.product.attribute.description .value',
      '.product.attribute.overview .value',
      '.product-info-main .product.attribute.description .value',
      '.product-info-main .product.attribute.overview .value',
      '#description .value',
      '#description',
      '.product.info.detailed .description .value',
      '.product.info.detailed .product.attribute.description .value'
    ];
    for (const sel of candidates) {
      const el = $(sel);
      if (!el) {
        continue;
      }
      const html =
        (el.innerHTML || '').trim();
      const text =
        (el.textContent || '').trim();
      if (
        html &&
        html
          .replace(/<[^>]+>/g, '')
          .trim()
          .length > 0
      ) {
        return {
          descriptionHtml: html,
          descriptionText: ''
        };
      }
      if (text) {
        return {
          descriptionHtml: '',
          descriptionText: text
        };
      }
    }
    return {
      descriptionHtml: '',
      descriptionText: ''
    };
  }
  function buildPayload() {
    const h1Text =
      $('.page-title-wrapper .base')
        ?.textContent
        .trim() ||
      $('.page-title-wrapper h1')
        ?.textContent
        .trim() ||
      '';
    const rawModelLine =
      $('.lisca-produc-id')
        ?.textContent
        .trim() ||
      '';
    const modelMatch =
      rawModelLine.match(/^([^\-\n]+)/);
    const modelRaw =
      modelMatch
        ? modelMatch[1].trim()
        : '';
    const modelName =
      toTitleCase(modelRaw);
    const titlePart =
      h1Text
        .replace(/[»«]/g, '')
        .replace(
          modelRaw
            ? new RegExp(
                escapeRegex(modelRaw),
                'i'
              )
            : /$^/,
          ''
        )
        .trim();
    const titleClean =
      toTitleCase(titlePart);
    const colorCode = getCurrentSupplierId().normalized.split('-')[1];
    const label = String(colorLabel || '').trim();
    const fallbackColor = label.replace(new RegExp('^' + escapeRegex(colorCode) + '\\s*(?:-\\s*)?', 'i'), '').trim();
    const kleurClean = toTitleCase(detectCurrentColor().colorName || fallbackColor || $('.related-list-selected-option')?.textContent?.replace(/^\s*[A-Za-z0-9]+\s*-\s*/, '').trim() || '');
    const computedName =
      `${modelName} ${titleClean} ${kleurClean}`
        .replace(/\s+/g, ' ')
        .trim();
    const form =
      $('.product-add-form form');
    const skuRaw =
      form
        ?.getAttribute('data-product-sku') ||
      '';
    const productCode =
      normalizeSku(skuRaw);
    const oldEl =
      $('.product-info-price .old-price .price');
    const finalEl =
      $('.product-info-price .special-price .price') ||
      $('.product-info-price .price-final_price .price') ||
      $('.product-info-price .final-price .price') ||
      $('.product-info-price .price');
    const oldBase =
      parsePriceText(
        oldEl?.textContent || ''
      );
    const finalBase =
      parsePriceText(
        finalEl?.textContent || ''
      );
    let rrp = '';
    let price = '';
    const oldMarked =
      Number.isFinite(oldBase)
        ? oldBase * MARKUP_FACTOR
        : NaN;
    const finalMarked =
      Number.isFinite(finalBase)
        ? finalBase * MARKUP_FACTOR
        : NaN;
    if (
      Number.isFinite(oldMarked) &&
      Number.isFinite(finalMarked) &&
      finalMarked < oldMarked
    ) {
      rrp =
        fmtMoney(oldMarked);
      price =
        fmtMoney(finalMarked);
    } else if (
      Number.isFinite(finalMarked)
    ) {
      rrp =
        fmtMoney(finalMarked);
    } else if (
      Number.isFinite(oldMarked)
    ) {
      rrp =
        fmtMoney(oldMarked);
    }
    const {
      descriptionHtml,
      descriptionText
    } =
      pickDescription();
    return {
      name: computedName,
      title: computedName,
      rrp,
      price,
      productCode,
      modelName,
      descriptionHtml,
      descriptionText,
      compositionUrl: location.href,
      reference: ' - [ext]',
      _sparkle: {
        source: SUPPLIER_NAME,
        v: 2,
        ts: new Date().toISOString()
      }
    };
  }
  function getCurrentSupplierId() {
    const forms =
      $$(
        '.product-add-form form[data-product-sku]'
      );
    if (forms.length !== 1) {
      throw new Error(
        `Supplier ID niet eenduidig: ${forms.length} productformulieren gevonden.`
      );
    }
    const rawSku =
      forms[0]
        .getAttribute('data-product-sku')
        ?.trim() ||
      '';
    if (!rawSku) {
      throw new Error(
        'Supplier ID ontbreekt op het huidige product.'
      );
    }
    const supplierId =
      normalizeSku(rawSku);
    if (!supplierId) {
      throw new Error(
        'Supplier ID kon niet worden bepaald.'
      );
    }
    return {
      raw: rawSku,
      normalized: supplierId
    };
  }
  function detectCurrentColor() {
    const candidates = [];
    const activeCandidates =
      $$(
        '.product-info-main .related-list a.active'
      );
    if (activeCandidates.length === 1) {
      const anchor =
        activeCandidates[0];
      const colorAttr =
        anchor
          .getAttribute('color')
          ?.trim();
      const titleAttr =
        anchor
          .getAttribute('title')
          ?.trim();
      if (colorAttr) {
        candidates.push(colorAttr);
      }
      if (titleAttr) {
        candidates.push(titleAttr);
      }
    }
    const selectedText =
      $('.related-list-selected-option')
        ?.textContent
        .trim();
    if (selectedText) {
      candidates.push(
        selectedText
      );
    }
    for (const candidate of candidates) {
      const raw =
        String(candidate || '')
          .trim();
      if (!raw) {
        continue;
      }
      /*
       * Voorbeelden:
       *
       * 02 - Black
       * 0M - Mom
       * 407 - Red
       */
      const match =
        raw.match(
          /^\s*([A-Za-z0-9]+)\s*-\s*(.+?)\s*$/
        );
      if (!match) {
        continue;
      }
      return {
        colorCode:
          match[1].trim(),
        colorName:
          match[2].trim(),
        colorRaw:
          raw,
        automatic:
          true
      };
    }
    return {
      colorCode: '',
      colorName: '',
      colorRaw: '',
      automatic: false
    };
  }
  function searchMagentoObject(obj, path = '$') {
    if (
      !obj ||
      typeof obj !== 'object'
    ) {
      return null;
    }
    for (
      const [key, value]
      of Object.entries(obj)
    ) {
      if (key === 'jsonConfig') {
        let candidate =
          value;
        if (
          typeof candidate === 'string'
        ) {
          try {
            candidate =
              JSON.parse(candidate);
          } catch {
            candidate = null;
          }
        }
        if (
          candidate &&
          typeof candidate === 'object' &&
          candidate.attributes &&
          candidate.optionPrices
        ) {
          return {
            config: candidate,
            path: `${path}.${key}`
          };
        }
      }
      if (
        value &&
        typeof value === 'object'
      ) {
        const hit =
          searchMagentoObject(
            value,
            `${path}.${key}`
          );
        if (hit) {
          return hit;
        }
      }
    }
    return null;
  }
  function normalizeDdoSize({
    band,
    cup,
    rawValues
  }) {
    band =
      String(band ?? '')
        .trim();

    cup =
      String(cup ?? '')
        .trim();


    // Geen BH:
    // velikost2 = 44
    // velikost1 = 0
    // => 44

    if (
      band &&
      cup === '0'
    ) {
      return band;
    }


    // BH:
    // 70 + D => 70D

    if (
      band &&
      cup
    ) {
      if (
        /^\d{2,3}$/.test(band) &&
        /^[A-Z]{1,3}$/i.test(cup)
      ) {
        return (
          band +
          cup.toUpperCase()
        );
      }

      throw new Error(
        `Niet-herkende Lisca maatcombinatie: velikost2="${band}", velikost1="${cup}"`
      );
    }


    // Eendimensionale maat

    const vals =
      Object.values(
        rawValues || {}
      )
        .map(value =>
          String(value ?? '').trim()
        )
        .filter(value =>
          value &&
          value !== '0'
        );

    const unique =
      [...new Set(vals)];

    if (unique.length === 1) {
      return unique[0];
    }

    throw new Error(
      `Maat kan niet eenduidig naar DDO worden vertaald: ${JSON.stringify(rawValues)}`
    );
  }


  async function extractExactSizeVariants() {
    const exactVariant =
      getCurrentExactVariant();
    const {
      html,
      config
    } =
      await fetchCurrentMagentoProduct();
    const attrs =
      config.attributes || {};
    const indexMap =
      config.index || {};
    const priceMap =
      config.optionPrices || {};
    const skuMap =
      config.sku || {};
    // ==========================================================
    // OPGEHAALDE PAGINA / PARENT SKU
    // ==========================================================
    const fetchedDoc =
      new DOMParser()
        .parseFromString(
          html,
          'text/html'
        );
    const fetchedForms =
      $$(
        '.product-add-form form[data-product-sku]',
        fetchedDoc
      );
    if (
      fetchedForms.length !== 1
    ) {
      throw new Error(
        `Supplier ID niet eenduidig in opgehaalde pagina: ${fetchedForms.length} productformulieren gevonden.`
      );
    }
    const fetchedParentSku =
      fetchedForms[0]
        .getAttribute('data-product-sku')
        ?.trim() ||
      '';
    if (
      !fetchedParentSku ||
      fetchedParentSku !==
        exactVariant.rawSupplierId
    ) {
      throw new Error(
        'De opnieuw opgehaalde pagina hoort niet bij het huidige product.'
      );
    }
    // ==========================================================
    // ECHTE CHILD PRODUCT IDs
    // ==========================================================
    const matrixChildIds =
      new Set();
    for (
      const attr
      of Object.values(attrs)
    ) {
      for (
        const option
        of attr.options || []
      ) {
        for (
          const productId
          of option.products || []
        ) {
          const id =
            String(
              productId ?? ''
            ).trim();
          // 0 is geen echt Magento child-product.
          if (
            !/^\d+$/.test(id) ||
            Number(id) <= 0
          ) {
            continue;
          }
          matrixChildIds.add(id);
        }
      }
    }
    if (!matrixChildIds.size) {
      throw new Error(
        'Geen child-varianten gevonden in de Lisca maatmatrix.'
      );
    }
    // ==========================================================
    // MAAT PER CHILD
    // ==========================================================
    const variantById =
      new Map();
    for (
      const productId
      of matrixChildIds
    ) {
      const values = {};
      for (
        const [attrId, attr]
        of Object.entries(attrs)
      ) {
        const matches =
          (attr.options || [])
            .filter(option => {
              const products =
                (option.products || [])
                  .map(id =>
                    String(
                      id ?? ''
                    ).trim()
                  )
                  .filter(id =>
                    /^\d+$/.test(id) &&
                    Number(id) > 0
                  );
              return products.includes(
                String(productId)
              );
            });
        if (matches.length !== 1) {
          throw new Error(
            `Child ${productId}: attribuut "${attr.code || attrId}" heeft ${matches.length} geldige maatmatches.`
          );
        }
        const option =
          matches[0];
        const label =
          String(
            option.label ?? ''
          ).trim();
        if (!label) {
          throw new Error(
            `Child ${productId}: lege maatwaarde bij "${attr.code || attrId}".`
          );
        }
        values[attr.code] =
          label;
        if (
          indexMap[productId] &&
          indexMap[productId][attrId] != null &&
          String(
            indexMap[productId][attrId]
          ) !==
          String(option.id)
        ) {
          console.warn(
            `⚠️ Magento index-conflict bij child ${productId}, attribuut ${attrId}. Matrixdata blijft leidend.`
          );
        }
      }
      const size =
        normalizeDdoSize({
          band:
            values.velikost2 || '',
          cup:
            values.velikost1 || '',
          rawValues:
            values
        });
      variantById.set(
        String(productId),
        {
          productId:
            String(productId),
          size,
          values,
          childSku:
            String(
              skuMap[productId] || ''
            ).trim()
        }
      );
    }
    // ==========================================================
    // EAN CODES
    //
    // Aantallen worden NIET als validatie gebruikt.
    // ==========================================================
    const eanMatch =
      html.match(
        /EAN_CODES:\s*([0-9,\s]+?)\s*-->/
      );
    const eans =
      eanMatch
        ? eanMatch[1]
            .split(',')
            .map(x => x.trim())
        : [];
    console.log(
      `ℹ️ Lisca bron: ${matrixChildIds.size} maatvarianten / ${eans.length} EAN-codes.`
    );
    // ==========================================================
    // CHILD VOLGORDE
    // ==========================================================
    const priceIds =
      Object.keys(priceMap)
        .filter(id =>
          matrixChildIds.has(
            String(id)
          )
        );
    const indexIds =
      Object.keys(indexMap)
        .filter(id =>
          matrixChildIds.has(
            String(id)
          )
        );
    let orderedChildIds = [];
    if (priceIds.length) {
      orderedChildIds =
        priceIds;
    } else if (indexIds.length) {
      orderedChildIds =
        indexIds;
    } else {
      orderedChildIds =
        [...matrixChildIds];
    }
    // Voeg matrixchildren toe die nog ontbreken.
    for (
      const productId
      of matrixChildIds
    ) {
      if (
        !orderedChildIds.includes(
          productId
        )
      ) {
        orderedChildIds.push(
          productId
        );
      }
    }
    // ==========================================================
    // DATASET
    //
    // GEEN aantallenblokkade.
    // ==========================================================
    const rows =
      orderedChildIds
        .map(
          (productId, position) => {
            const variant =
              variantById.get(
                String(productId)
              );
            if (!variant) {
              return null;
            }
            const possibleEan =
              String(
                eans[position] ?? ''
              ).trim();
            return {
              size:
                variant.size,
              ean:
                isValidEan(possibleEan)
                  ? possibleEan
                  : null,
              stock:
                null,
              supplierId:
                exactVariant.supplierId,
              rawSupplierId:
                exactVariant.rawSupplierId,
              childProductId:
                String(productId),
              childSku:
                variant.childSku ||
                null,
              colorCode:
                exactVariant.colorCode,
              colorName:
                exactVariant.colorName,
              exact:
                true
            };
          }
        )
        .filter(Boolean);
    // ==========================================================
    // DUBBELE EXACTE REGELS VERWIJDEREN
    // ==========================================================
    const unique =
      new Map();
    for (const row of rows) {
      const key =
        [
          row.size,
          row.ean || '',
          row.supplierId
        ].join('|');
      if (!unique.has(key)) {
        unique.set(
          key,
          row
        );
      }
    }
    const result =
      [...unique.values()];
    if (!result.length) {
      throw new Error(
        'Geen Lisca maatvarianten gevonden.'
      );
    }
    console.table(
      result.map(row => ({
        maat:
          row.size,
        ean:
          row.ean || '',
        supplierId:
          row.supplierId,
        childId:
          row.childProductId,
        childSku:
          row.childSku || '',
        kleur:
          row.colorCode
      }))
    );
    console.log(
      `✅ ${result.length} Lisca maatregels opgebouwd.`
    );
    return result;
  }
 function getCurrentExactVariant(){const supplier=getCurrentSupplierId(),color=detectCurrentColor();return {supplierId:supplier.normalized,rawSupplierId:supplier.raw,colorCode:color.colorCode||supplier.normalized.split('-')[1],colorName:color.colorName};}
 async function fetchCurrentMagentoProduct(){for(const script of $$('script[type="text/x-magento-init"]')){try{const hit=searchMagentoObject(JSON.parse(script.textContent));if(hit)return {html,doc:document,config:hit.config};}catch{}}throw Error('Geen Magento variantconfig gevonden voor dit Lisca-product');}
 return {product:buildPayload,variants:extractExactSizeVariants};
};

(() => {
  'use strict';
  if(location.hostname!=='www.dutchdesignersoutlet.com'||window.top!==window.self)return;
  const ID='lisca',VERSION='2.0.4',SHEET='1JGQp-sgPp-6DIbauCUSFWTNnljLyMWww',GID='933070542',TTL=120000,CACHE_SCHEMA=2;
  const TABLE='#tabs-3 table.options',PID='#tabs-1 input[name="supplier_pid"]',BRAND='#tabs-1 #select2-brand-container';
  const $=(selector,root=document)=>root.querySelector(selector),decode=event=>{try{return JSON.parse(event.detail||'{}')}catch{return {}}},send=(name,data)=>document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`,{detail:JSON.stringify(data)}));
  let sheetMemory=null,busy=false;
  function normSize(value){let size=String(value||'').toUpperCase().replace(/\s+/g,'').replace(/\(.*?\)/g,'').trim();if(size==='2XL')return'XXL';const xl=size.match(/^(\d+)XL$/);if(xl)size='X'.repeat(Number(xl[1]))+'L';return size}
  function normColor(value){const color=String(value||'').trim().toUpperCase();return /^\d+$/.test(color)?String(Number(color)):color}
  function parsePid(value){const match=String(value||'').trim().toUpperCase().match(/^(\d+)\s*-\s*([A-Z0-9]+)$/);return match?{article:match[1],color:normColor(match[2]),cacheId:`${match[1]}-${normColor(match[2])}`}:{article:'',color:'',cacheId:''}}
  function isLisca(){const node=$(BRAND),selected=$('#tabs-1 select[name="brand"] option:checked'),value=(node?.getAttribute('title')||node?.textContent||selected?.textContent||'').trim().toLowerCase();return /\blisca\b/.test(value)}
  function announce(){const available=isLisca();send('adapter-state',{id:ID,label:'Lisca',version:VERSION,updateUrl:'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-lisca.user.js',priority:70,available,reason:available?'':'Geen Lisca-merk'})}
  function status(requestId,text,kind='busy',done=false,changed=0,autoSave=false){send('adapter-status',{requestId,text,kind,done,changed,autoSave})}
  function get(url){return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url,withCredentials:true,timeout:20000,headers:{Accept:'text/csv,text/plain,*/*;q=0.8'},onload:response=>resolve(response),onerror:()=>reject(Error('Netwerkfout bij Lisca-sheet')),ontimeout:()=>reject(Error('Timeout bij Lisca-sheet'))}))}
  const validSheet=response=>response?.status===200&&typeof response.responseText==='string'&&response.responseText.trim()&&!/^\s*</.test(response.responseText);
  async function sheet(force){if(!force&&sheetMemory&&Date.now()-sheetMemory.time<TTL)return sheetMemory.text;const urls=[`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID}`];for(let user=0;user<=9;user++)urls.push(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID}&authuser=${user}`,`https://docs.google.com/u/${user}/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID}`);for(const url of urls){try{const response=await get(url);if(validSheet(response)){sheetMemory={time:Date.now(),text:response.responseText};return sheetMemory.text}}catch{}}throw Error('Geen toegang tot de Lisca EAN-sheet')}
  function csv(text){const rows=[];let field='',row=[],quoted=false;for(let i=0;i<text.length;i++){const char=text[i];if(quoted){if(char==='"'&&text[i+1]==='"'){field+='"';i++}else if(char==='"')quoted=false;else field+=char}else if(char==='"')quoted=true;else if(char===','){row.push(field);field=''}else if(char==='\n'){row.push(field);rows.push(row);row=[];field=''}else if(char!=='\r')field+=char}row.push(field);rows.push(row);return rows}
  function stock(raw){if(String(raw??'').trim()==='')return null;const value=Number.parseInt(raw,10);if(!Number.isFinite(value))return null;if(value<=2)return 1;if(value===3)return 2;if(value===4)return 3;return 5}
  function sizeKey(base,cupIndex){const index=Number.parseInt(cupIndex||'0',10);if(!Number.isInteger(index)||index<0||index>26)return'';if(index===0)return normSize(base);return normSize(`${base}${String.fromCharCode(64+index)}`)}
  function buildMap(text,pid){const map=new Map();for(const columns of csv(text)){const article=String(columns[0]||'').trim(),color=normColor(columns[2]),size=sizeKey(columns[4],columns[3]);if(article!==pid.article||color!==pid.color||!size)continue;const rawEan=String(columns[5]||'').trim(),ean=/^\d{8,14}$/.test(rawEan)?rawEan:'',mappedStock=stock(columns[6]),entry={ean,stock:mappedStock,row:columns};if(!ean&&!Number.isFinite(mappedStock))continue;const known=map.get(size);if(!known){map.set(size,entry);continue}if(known.ean&&ean&&known.ean!==ean)throw Error(`Conflicterende exacte Lisca-EAN voor ${size}`);if(Number.isFinite(known.stock)&&Number.isFinite(mappedStock)&&known.stock!==mappedStock)throw Error(`Conflicterende exacte Lisca-stock voor ${size}`);map.set(size,{ean:known.ean||ean,stock:Number.isFinite(known.stock)?known.stock:mappedStock,row:known.row})}return map}
  const cacheKey=pid=>`ddoLisca:${pid.cacheId}`;
  function readCache(pid){try{const cached=JSON.parse(localStorage.getItem(cacheKey(pid))||'null');if(!cached||cached.schema!==CACHE_SCHEMA||Date.now()-cached.time>TTL||!Array.isArray(cached.entries))return null;return new Map(cached.entries)}catch{return null}}
  function writeCache(pid,map){try{localStorage.setItem(cacheKey(pid),JSON.stringify({schema:CACHE_SCHEMA,time:Date.now(),entries:[...map.entries()].map(([size,value])=>[size,{ean:value.ean,stock:value.stock}])}))}catch(error){console.warn('[DDO Adapter / Lisca] Compacte cache kon niet worden opgeslagen.',error)}}
  async function data(pid,force){if(!force){const cached=readCache(pid);if(cached)return cached}const map=buildMap(await sheet(!!force),pid);if(map.size)writeCache(pid,map);return map}
  function input(element,value){element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))}
  function apply(map){let changed=0;const unmatched=[];document.querySelectorAll(`${TABLE} tbody tr`).forEach(row=>{const sizeField=$('input.product_option_small',row)||$('td:first-child select,td:first-child input',row),rawSize=sizeField?.value||$('td:first-child',row)?.textContent,size=normSize(rawSize),entry=map.get(size),ean=$('input[name$="[barcode]"]',row),stockInput=$('input[name$="[stock]"]',row);if(!entry){if(size)unmatched.push({local:String(rawSize||'').trim(),normalized:size});return}let altered=false;if(ean&&entry.ean&&ean.value!==entry.ean){input(ean,entry.ean);altered=true}if(stockInput&&Number.isFinite(entry.stock)&&stockInput.value!==String(entry.stock)){input(stockInput,entry.stock);altered=true}if(altered)changed++});if(unmatched.length)console.warn('[DDO Adapter / Lisca] Lokale maten zonder exacte sheetmatch',{unmatched,remoteSizes:[...map.keys()]});return changed}
  document.addEventListener('ddo-toolbox:discover',announce);
  document.addEventListener('ddo-toolbox:run-adapter',async event=>{const request=decode(event);if(request.id!==ID)return;if(busy||!isLisca())return;const pid=parsePid($(PID)?.value);if(!pid.article||!pid.color)return status(request.requestId,'Lisca Supplier PID vereist exact ARTIKEL-KLEUR','error',true,0,request.autoSave);const originalTable=$(TABLE),originalRows=originalTable?[...originalTable.querySelectorAll('input,select')].map(e=>[e,e.value]):[];busy=true;try{status(request.requestId,request.forceRefresh?'Lisca-sheet vernieuwen…':'Lisca-cache controleren…');const map=await data(pid,!!request.forceRefresh);if(!map.size)return status(request.requestId,'Geen exacte Lisca-regels voor dit product','error',true,0,request.autoSave);if(!isLisca()||parsePid($(PID)?.value).cacheId!==pid.cacheId||$(TABLE)!==originalTable||originalRows.some(([e,v])=>!e.isConnected||e.value!==v))throw Error('Product gewijzigd; start opnieuw');const changed=apply(map);status(request.requestId,`${changed} rijen exact gevuld`,'success',true,changed,!!request.autoSave)}catch(error){console.error('[DDO Adapter / Lisca]',error);status(request.requestId,error.message||'Ophalen mislukt','error',true,0,request.autoSave)}finally{busy=false}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',announce,{once:true});else announce();
})();

(() => {
'use strict';
if(location.hostname!=='b2b-eu.lisca.com'||window.top!==window.self)return;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)],CACHE='edi:lisca:ddo:v1';
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function code(s){const m=String(s||'').toUpperCase().match(/(?:^|[^A-Z0-9])(\d{6})-?([A-Z0-9]{2})(?=$|[^A-Z0-9])/);return m?`${m[1]}-${m[2]}`:'';}
function cardCode(card){return code($('.lisca-produc-id,.lisca-product-id',card)?.textContent)||$$('img',card).flatMap(i=>['src','data-original','data-hoversrc','data-origsrc'].map(a=>code(i.getAttribute(a)))).find(Boolean)||$$('a[href]',card).map(a=>code(a.href)).find(Boolean)||'';}
let map=null,busy=false,signature='';
const status=s=>{$('#lc-status').textContent=s;};
const link=pid=>{const hit=map?.get(pid);return !map?'—':hit?`<a href="https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=${encodeURIComponent(hit)}" target="_blank" rel="noopener">✓ ${esc(hit)}</a>`:'× Ontbreekt';};
function colors(){const current=code($('.product-add-form form[data-product-sku]')?.dataset.productSku);if(!current)return [];const entries=new Map();for(const a of $$('.product-info-main .related-list a[href]')){const pid=code(a.href)||code(a.getAttribute('data-product-sku'));if(!pid||pid.split('-')[0]!==current.split('-')[0])continue;const url=new URL(a.href,location.href);if(url.origin!==location.origin)continue;entries.set(pid,{pid,url:url.href,label:a.getAttribute('color')||a.title||pid.split('-')[1]});}if(!entries.has(current))entries.set(current,{pid:current,url:location.href,label:$('.related-list-selected-option')?.textContent.trim()||current.split('-')[1]});return [...entries.values()].sort((a,b)=>a.pid.localeCompare(b.pid));}
async function pageData(item){const r=await fetch(item.url,{credentials:'include',cache:'no-store'});if(!r.ok)throw Error(`Lisca: HTTP ${r.status}`);const html=await r.text(),doc=new DOMParser().parseFromString(html,'text/html');if(code($('.product-add-form form[data-product-sku]',doc)?.dataset.productSku)!==item.pid)throw Error('Opgehaalde pagina hoort niet bij deze kleur; controleer de login');return {html,reader:LISCA_PRODUCT(doc,item.url,html,item.label)};}
function gallery(html,url){const urls=[];for(const m of html.matchAll(/"full"\s*:\s*("(?:\\.|[^"\\])*")/g)){try{const u=new URL(JSON.parse(m[1]),url);if(/^https?:$/.test(u.protocol))urls.push(u.href);}catch{}}return [...new Set(urls)];}
async function action(item,kind,button){button.disabled=true;try{status(`${item.pid}: ophalen…`);const {html,reader}=await pageData(item);if(kind==='photos'){const urls=gallery(html,item.url);if(!urls.length)throw Error('Geen originele foto’s gevonden');for(let i=0;i<urls.length;i++)await new Promise((resolve,reject)=>GM_download({url:urls[i],name:`${item.pid}_${i+1}.jpg`,onload:resolve,onerror:()=>reject(Error('Foto downloaden mislukt')),ontimeout:()=>reject(Error('Foto downloaden duurde te lang'))}));status(`${urls.length} foto’s gedownload`);return;}let text;if(kind==='product')text=DDO_EDI.productClipboard(reader.product());else{const rows=await reader.variants();text=kind==='sizes'?DDO_EDI.sizesClipboard('Lisca',item.pid,rows.map(r=>r.size)):DDO_EDI.eanTSV(rows.filter(r=>r.ean),item.pid);}if(!text)throw Error('Geen beschikbare EAN-codes');GM_setClipboard(text);status(`${item.pid}: ${kind==='product'?'Product':kind==='sizes'?'Maten':'EAN-codes'} gekopieerd`);}catch(e){status(e.message);}finally{button.disabled=false;}}
function render(){const cart=DDO_EDI.isCartPage(),items=cart?[]:colors();$('#lc-edi').hidden=cart;$('#lc-order').hidden=!cart;if(cart)return;const sig=JSON.stringify([items,map?[...map]:null]);if(sig!==signature){signature=sig;$('#lc-colors').innerHTML=items.length?`<div class="edi-pdp-meta"><strong>${esc(items[0].pid.split('-')[0])}</strong></div><div class="edi-summary">${map?`${items.filter(i=>map.has(i.pid)).length}/${items.length} leverancierskleuren in DDO`:''}</div><div class="edi-colors">${items.map((i,n)=>`<div class="edi-color-row"><div class="edi-color-main"><a class="edi-color-select" href="${esc(i.url)}"><span class="edi-swatch"></span><span class="edi-color-label" title="${esc(i.label)}">${esc(i.label)}</span></a><span class="edi-match ${map?(map.has(i.pid)?'edi-match-ok':'edi-match-miss'):''}">${link(i.pid)}</span></div><div class="edi-actions">${[['product','Product'],['sizes','Maten'],['ean','EAN'],['photos','Foto’s']].map(([k,t])=>`<button type="button" class="edi-action" data-index="${n}" data-action="${k}">${t}</button>`).join('')}</div></div>`).join('')}</div>`:'Open een product om Product, Maten, EAN en Foto’s te gebruiken.';$$('[data-action]',$('#lc-colors')).forEach(b=>b.onclick=()=>action(items[Number(b.dataset.index)],b.dataset.action,b));}
for(const card of $$('li.item.product.product-item, .product-item-info').filter(c=>!c.parentElement.closest('li.item.product.product-item'))){const pid=cardCode(card);let badge=$('.lc-card-status',card);if(!map||!pid){badge?.remove();continue;}if(!badge){badge=document.createElement('div');badge.className='lc-card-status';card.append(badge);}const html=link(pid);if(badge.innerHTML!==html)badge.innerHTML=html;badge.style.color=map.has(pid)?'#18864b':'#c83939';}}
function exportMap(buffer){const wb=XLSX.read(buffer,{type:'array'}),result=new Map();for(const name of wb.SheetNames){const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:''});const h=(rows[0]||[]).map(v=>String(v).trim().toLowerCase()),pi=h.indexOf('product id'),ii=h.indexOf('image');for(const row of rows.slice(1)){const pid=code(row[pi<0?3:pi]),id=String(row[ii<0?1:ii]||'').match(/\/img\/product\/(\d+)(?=[_.\/]|$)/)?.[1];if(pid&&id)result.set(pid,id);}}return result;}
function exportBrand(id){return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'POST',url:`https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=${id}`,headers:{'Content-Type':'application/x-www-form-urlencoded'},data:'format=excel&export=Export+products',responseType:'arraybuffer',timeout:60000,onload:r=>{try{if(r.status!==200)throw Error(`Merk ${id}: HTTP ${r.status}`);const bytes=new Uint8Array(r.response||[]);if(!bytes.length||bytes[0]===60)throw Error('Geen Excel-export ontvangen; controleer DDO-login');resolve(exportMap(r.response));}catch(e){reject(e);}},onerror:()=>reject(Error(`Netwerkfout merk ${id}`)),ontimeout:()=>reject(Error(`Timeout merk ${id}`))}));}
async function check(force=false){if(busy)return;busy=true;$$('.edi-toolbar button',panel).forEach(b=>b.disabled=true);try{let saved;try{saved=JSON.parse(localStorage.getItem(CACHE));}catch{}if(!force&&saved&&Date.now()-saved.time<900000){map=new Map(saved.entries);status('DDO-controle uit recente cache · Opnieuw checken vernieuwt de gegevens.');}else{const all=[];for(const [index,id] of [155,188,211,212].entries()){status(`DDO-exports ophalen: ${index+1}/4 · merk ${id}`);all.push(...await exportBrand(id));}if(!all.length)throw Error('Geen bruikbare Lisca-producten in DDO-export');map=new Map(all);try{localStorage.setItem(CACHE,JSON.stringify({time:Date.now(),entries:[...map]}));}catch{}status(`Modelcheck actief · ${map.size} producten · alle 4 merken opgehaald`);}render();}catch(e){map=null;status(e.message);render();}finally{busy=false;$$('.edi-toolbar button',panel).forEach(b=>b.disabled=false);}}
const style=document.createElement('style');style.textContent=`#edi-lisca,#edi-lisca :where(*){all:revert;box-sizing:border-box}#edi-lisca :where(*){font:inherit;color:inherit;letter-spacing:normal;text-transform:none}#edi-lisca :where(*::before,*::after){content:none}#edi-lisca{margin:0;padding:0;text-align:left;direction:ltr;position:fixed;top:18px;right:18px;width:430px;max-width:calc(100vw - 24px);z-index:2147483000;overflow:hidden}#edi-lisca .edi-head{display:flex;align-items:center;cursor:move;user-select:none;touch-action:none}#edi-lisca button{all:unset;box-shadow:none;background-image:none;appearance:none;transform:none;text-shadow:none;box-sizing:border-box;display:inline-block;text-align:center;cursor:pointer;width:auto;min-width:0;max-width:100%;height:auto;margin:0;float:none;position:static;letter-spacing:normal;text-transform:none;white-space:normal}#edi-lisca a{color:inherit;text-decoration:none}.lc-card-status{font:600 12px system-ui;margin:6px 0}.lc-card-status a{color:inherit}`+DDO_EDI.theme.replaceAll('#edi-lingadore','#edi-lisca')+DDO_EDI.layout.replaceAll('#edi-lingadore','#edi-lisca');document.head.append(style);
// Promote only panel rules; preserve the shared layout and its cascade order.
for(const rule of style.sheet.cssRules){if(!rule.selectorText?.includes('#edi-lisca'))continue;rule.selectorText=rule.selectorText.replaceAll('#edi-lisca','#edi-lisca#edi-lisca');const declarations=[...rule.style].map(property=>[property,rule.style.getPropertyValue(property)]);for(const [property,value] of declarations)rule.style.setProperty(property,value,'important');}
const panel=document.createElement('section');panel.id='edi-lisca';panel.innerHTML=`<div class="edi-head"><div class="edi-title">Toolbox · Lisca<span class="edi-version">v2.0.4</span></div><button type="button" class="edi-icon-btn" id="lc-collapse" aria-label="Inklappen">−</button></div><div class="edi-body"><details class="edi-module" id="lc-edi" open><summary>EDI-module</summary><div class="edi-toolbar"><button type="button" class="edi-btn" id="lc-check">Controleer in DDO</button><button type="button" class="edi-btn" id="lc-refresh">Opnieuw checken</button><button type="button" class="edi-btn edi-danger" id="lc-reset">Reset</button></div><div class="edi-status" id="lc-status" role="status">Modelcheck wacht op startsignaal</div><div id="lc-colors"></div></details><details class="edi-module" id="lc-order" open><summary>Ordermodule</summary><p class="edi-module-note">Ordermodule niet van toepassing op deze leverancier.</p></details></div>`;document.body.append(panel);
// Inline important positions override the protected panel CSS while dragging.
const head=$('.edi-head',panel);let drag=null;
function positionPanel(left,top){const x=Math.max(0,Math.min(left,Math.max(0,innerWidth-panel.offsetWidth))),y=Math.max(0,Math.min(top,Math.max(0,innerHeight-panel.offsetHeight)));panel.style.setProperty('left',x+'px','important');panel.style.setProperty('top',y+'px','important');panel.style.setProperty('right','auto','important');}
head.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button,a'))return;const rect=panel.getBoundingClientRect();drag={id:event.pointerId,dx:event.clientX-rect.left,dy:event.clientY-rect.top};head.setPointerCapture(event.pointerId);event.preventDefault();});
head.addEventListener('pointermove',event=>{if(drag?.id!==event.pointerId)return;positionPanel(event.clientX-drag.dx,event.clientY-drag.dy);});
function endDrag(event){if(drag?.id!==event.pointerId)return;drag=null;if(head.hasPointerCapture(event.pointerId))head.releasePointerCapture(event.pointerId);}
head.addEventListener('pointerup',endDrag);head.addEventListener('pointercancel',endDrag);head.addEventListener('lostpointercapture',()=>{drag=null;});
window.addEventListener('resize',()=>{const rect=panel.getBoundingClientRect();positionPanel(rect.left,rect.top);});
$('#lc-collapse').onclick=()=>{const body=$('.edi-body',panel);body.hidden=!body.hidden;$('#lc-collapse').textContent=body.hidden?'+':'−';};$('#lc-check').onclick=()=>check();$('#lc-refresh').onclick=()=>check(true);$('#lc-reset').onclick=()=>{map=null;localStorage.removeItem(CACHE);status('Modelcheck gereset');render();};
render();let timer;new MutationObserver(records=>{if(records.every(r=>panel.contains(r.target)||r.target.closest?.('.lc-card-status')))return;clearTimeout(timer);timer=setTimeout(render,150);}).observe(document.body,{childList:true,subtree:true});
})();


})();
