// ==UserScript==
// @name         GG Toolbox | Adapter | Warehousing
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.0.1
// @description  Orderlogboek, Return Textual en Return Visual voor de Beheerder.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @noframes
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-warehousing.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-warehousing.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window !== window.top || window.__ggWarehousing) return;

  const allowed = () =>
    window.__ggToolbox?.isEnabled('warehousing') === true;

  const isOrderView = () =>
    /^\/orders\/view\//.test(location.pathname);

  const isOrders = () =>
    /^\/orders(?:\/|$)/.test(location.pathname) && !isOrderView();

  const isReturnView = () =>
    /^\/returns\/view\//.test(location.pathname);

  const isReturns = () =>
    /^\/returns(?:\/|$)/.test(location.pathname) && !isReturnView();

  const requireAccess = () => {
    if (!allowed()) throw new Error('Geen toegang tot Warehousing');
  };

  const text = el =>
    String(
      el?.querySelector('a')?.textContent ??
      el?.textContent ??
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();

  const cell = (row, n) =>
    row.querySelector('td:nth-child(' + n + ')');

  function today() {
    const d = new Date();

    return [d.getDate(), d.getMonth() + 1]
      .map(n => String(n).padStart(2, '0'))
      .join('-') + '-' + d.getFullYear();
  }

  function dateOnly(value) {
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) {
      return today();
    }

    return (
      value.match(/\b\d{2}-\d{2}-\d{4}\b/)?.[0] ||
      value.split(' ')[0] ||
      ''
    );
  }

  function returnTSV(row) {
    return [
      'Return',
      text(cell(row, 4)),
      text(cell(row, 5)),
      dateOnly(text(cell(row, 8))),
      '',
      text(cell(row, 6)),
      'Refund Retail'
    ].join('\t');
  }

function orderTSV(row) {
  const customer = cell(row, 4);

  const tags = [
    ...(customer?.querySelectorAll(
      'span.order-tag,.tag,.badge'
    ) || [])
  ].map(el =>
    el.textContent.trim().toLowerCase()
  );

  const wholesale =
    tags.includes('b2b') ||
    /\bB2B\b/i.test(customer?.textContent || '');

  const count = Number.parseInt(
    text(cell(row, 6)).match(/\d+/)?.[0],
    10
  );

  const country = text(cell(row, 5)).trim().toUpperCase();

  const carrier = ['NL', 'DE', 'BE'].includes(country)
    ? 'DPD'
    : 'UPS';

  return [
    text(cell(row, 7)),
    text(cell(row, 3)),
    text(customer),
    dateOnly(text(cell(row, 8))),
    country,
    String(
      Number.isNaN(count)
        ? 0
        : Math.max(0, count - 1)
    ),
    wholesale ? 'Wholesale' : 'Retail',
    carrier
  ].join('\t');
}

  function selectedOrderRows() {
    return [
      ...new Set(
        [
          ...document.querySelectorAll(
            '#order_index_datatable input.orders:checked'
          )
        ]
          .map(cb => cb.closest('tr'))
          .filter(Boolean)
      )
    ].reverse();
  }

  function toast(message) {
    const el = document.createElement('div');

    el.dataset.ggWhOwned = '';
    el.textContent = message;

    el.style.cssText = `
      position:fixed;
      right:12px;
      bottom:12px;
      z-index:999999;
      background:#263746;
      color:#fff;
      padding:10px 12px;
      border-radius:6px;
      font:12px system-ui;
    `;

    document.body.append(el);

    setTimeout(() => el.remove(), 2500);
  }

  async function copyText(value) {
    requireAccess();

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      requireAccess();

      const field = document.createElement('textarea');

      field.value = value;
      field.style.cssText =
        'position:fixed;opacity:0';

      document.body.append(field);

      try {
        field.select();

        if (!document.execCommand('copy')) {
          throw new Error(
            'Kopiëren niet toegestaan door de browser'
          );
        }
      } finally {
        field.remove();
      }
    }

    toast('Gekopieerd naar klembord.');
  }

  let libraryPromise = null;

  function loadCanvas() {
    if (typeof window.html2canvas === 'function') {
      return Promise.resolve(window.html2canvas);
    }

    if (libraryPromise) {
      return libraryPromise;
    }

    libraryPromise = new Promise((resolve, reject) => {
      const src =
        'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

      const existing =
        document.querySelector(
          'script[src="' + src + '"]'
        );

      const script =
        existing ||
        document.createElement('script');

      let timer;

      const cleanup = () => {
        clearTimeout(timer);
        script.removeEventListener('load', loaded);
        script.removeEventListener('error', failed);
      };

      const failed = () => {
        cleanup();

        if (!existing) {
          script.remove();
        }

        reject(
          new Error(
            'Screenshotbibliotheek kon niet worden geladen'
          )
        );
      };

      const loaded = () => {
        if (typeof window.html2canvas !== 'function') {
          return failed();
        }

        cleanup();
        resolve(window.html2canvas);
      };

      script.addEventListener('load', loaded);
      script.addEventListener('error', failed);

      timer = setTimeout(failed, 20000);

      if (!existing) {
        script.src = src;
        document.head.append(script);
      }
    }).catch(error => {
      libraryPromise = null;
      throw error;
    });

    return libraryPromise;
  }

function prepareCapture(doc) {
  const history = [...doc.querySelectorAll('.m-portlet__head-text')]
    .find(el => el.textContent.trim() === 'Retour geschiedenis');

  const blocks = [
    doc.querySelector('.returnStatus')?.closest('.col-lg-12'),
    history?.closest('.col-md-5'),
    doc.querySelector(
      '.cancelReturn,.reRunEvents,.updated_at,.created_at'
    )?.closest('.col-md-12')
  ];

  blocks.forEach(el => {
    if (el) el.style.display = 'none';
  });

  doc.querySelectorAll('#gg-toolbox,[data-gg-wh-owned]')
    .forEach(el => el.remove());

  /*
   * Externe afbeeldingen verwijderen.
   * Voorkomt CORS-spam van html2canvas.
   */
  doc.querySelectorAll('img').forEach(img => {
    try {
      const url = new URL(img.src, location.href);

      if (url.origin !== location.origin) {
        img.remove();
      }
    } catch {
      img.remove();
    }
  });

  const target = doc.querySelector('.page-content');

  if (target) {
    target.style.overflow = 'visible';
  }
}

  async function captureReturn() {
    requireAccess();

    if (!isReturnView()) {
      throw new Error('Open eerst een retour');
    }

    const target =
      document.querySelector('.page-content');

    if (!target) {
      throw new Error('Retourinhoud ontbreekt');
    }

    const capture = await loadCanvas();

    requireAccess();

    const canvas = await capture(target, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      scale: window.devicePixelRatio || 1,
      scrollX: 0,
      scrollY: 0,
      windowWidth:
        document.documentElement.clientWidth,
      windowHeight:
        document.documentElement.clientHeight,
      onclone: prepareCapture
    });

    requireAccess();

    if (
      navigator.clipboard?.write &&
      window.ClipboardItem
    ) {
      try {
        const blob = await new Promise(resolve =>
          canvas.toBlob(resolve, 'image/png')
        );

        if (!blob) {
          throw new Error(
            'Afbeelding kon niet worden gemaakt'
          );
        }

        requireAccess();

        await navigator.clipboard.write([
          new window.ClipboardItem({
            'image/png': blob
          })
        ]);

        toast(
          'Retourafbeelding gekopieerd.'
        );

        return;
      } catch {
        requireAccess();
      }
    }

    const link =
      document.createElement('a');

    link.download = 'retour.png';
    link.href =
      canvas.toDataURL('image/png');

    link.click();

    toast(
      'Kopiëren niet beschikbaar; retourafbeelding gedownload.'
    );
  }

  let busy = false;

  async function run(action) {
    if (busy || !allowed()) return;

    busy = true;

    try {
      await action();
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
    }
  }

  function button(
    title,
    icon,
    action
  ) {
    const el =
      document.createElement('button');

    el.type = 'button';
    el.title = title;

    el.setAttribute(
      'aria-label',
      title
    );

    el.dataset.ggWhOwned = '';

    el.innerHTML =
      '<i class="fa ' +
      icon +
      '" aria-hidden="true"></i>';

    el.addEventListener(
      'click',
      event => {
        event.preventDefault();
        event.stopPropagation();

        void run(action);
      }
    );

    return el;
  }

  function refresh() {
    const access = allowed();

    if (!access) {
      document
        .querySelectorAll(
          '[data-gg-wh-owned]'
        )
        .forEach(el => el.remove());

      return;
    }

    /*
     * RETURNS OVERZICHT
     */

    if (isReturns()) {
      for (
        const row of document.querySelectorAll(
          '#returnOrderIndexTable tbody tr'
        )
      ) {
        const badge =
          cell(row, 1)?.querySelector(
            '.m-badge'
          );

        if (
          !badge ||
          badge.querySelector(
            '[data-gg-wh-owned]'
          )
        ) {
          continue;
        }

        const el = button(
          'Kopieer retourgegevens voor Refund Retail',
          'fa-copy',
          () => {
            if (isReturns()) {
              return copyText(
                returnTSV(row)
              );
            }
          }
        );

        el.style.cssText = `
          background:transparent;
          border:0;
          padding:0;
          color:#fff;
          cursor:pointer;
        `;

        badge.append(el);
      }
    }

    /*
     * ORDERS OVERZICHT
     */

    let orderButton =
      document.getElementById(
        'gg-wh-orders'
      );

    if (isOrders()) {
      const container =
        document.querySelector(
          '.orders-index-search-container .d-flex.flex-nowrap.btn-group.mr-2'
        );

      if (
        container &&
        !orderButton
      ) {
        orderButton = button(
          'Kopieer geselecteerde orders voor het logboek',
          'fa-copy',
          () => {
            if (!isOrders()) return;

            const rows =
              selectedOrderRows();

            if (!rows.length) {
              toast(
                'Geen orders geselecteerd.'
              );

              return;
            }

            return copyText(
              rows
                .map(orderTSV)
                .join('\n')
            );
          }
        );

        orderButton.id =
          'gg-wh-orders';

        orderButton.className =
          'btn btn-secondary-o';

        orderButton.style.width =
          '45px';

        container.parentNode.insertBefore(
          orderButton,
          container
        );
      }

      if (orderButton) {
        orderButton.hidden =
          !selectedOrderRows().length;
      }
    } else {
      orderButton?.remove();
    }

    /*
     * RETOUR DETAIL
     */

    let visual =
      document.getElementById(
        'gg-wh-return-visual'
      );

    if (isReturnView()) {
      const nav =
        document.querySelector(
          '.m-stack__item.m-topbar__nav-wrapper ul.m-topbar__nav'
        );

      if (
        nav &&
        !visual
      ) {
        visual =
          document.createElement('li');

        visual.id =
          'gg-wh-return-visual';

        visual.dataset.ggWhOwned = '';

        visual.className =
          'm-nav__item m-topbar__notifications';

        const el = button(
          'Kopieer retour als afbeelding (Shift+C)',
          'fa-camera',
          captureReturn
        );

        el.className =
          'm-nav__link';

        el.style.cssText = `
          border:0;
          background:transparent;
          cursor:pointer;
        `;

        visual.append(el);

        nav.prepend(visual);
      }
    } else {
      visual?.remove();
    }
  }

  let refreshTimer;

  function schedule() {
    clearTimeout(refreshTimer);

    refreshTimer =
      setTimeout(refresh, 75);
  }

  function boot() {
    refresh();

    new MutationObserver(schedule)
      .observe(
        document.body,
        {
          childList: true,
          subtree: true
        }
      );

    setInterval(
      refresh,
      1000
    );

    document.addEventListener(
      'change',
      schedule
    );

    window.addEventListener(
      'keydown',
      event => {
        if (
          !allowed() ||
          !isReturnView() ||
          event.repeat ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          !event.shiftKey ||
          event.key.toLowerCase() !== 'c'
        ) {
          return;
        }

        if (
          event.target?.closest?.(
            'input,textarea,select,[contenteditable]:not([contenteditable="false"])'
          )
        ) {
          return;
        }

        event.preventDefault();

        void run(captureReturn);
      }
    );
  }

  window.__ggWarehousing = {
    version: '1.0.1'
  };

  if (document.body) {
    boot();
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      boot,
      { once: true }
    );
  }
})();
