// ==UserScript==
// @name         DDO Toolbox | Adapter | GoedGepickt Queue
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.2.0
// @description  Bouw een GoedGepickt-queue op uit selecties of Product ID's en pusht producten één voor één.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-gg-queue.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-gg-queue.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ID = 'ggQueue';
  const VERSION = '1.2.0';

  const UPDATE_URL =
    'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-gg-queue.user.js';

  const STORAGE_KEY = '__DDO_GG_QUEUE_V1__';
  const BUILD_KEY = '__DDO_GG_QUEUE_BUILD_V1__';
  const SOURCE_KEY = '__DDO_GG_QUEUE_SOURCE__';

  const TIMEOUT = 90000;
  const PANEL_ID = 'ddo-gg-queue-panel';
  const BUILDER_ID = 'ddo-gg-queue-builder';
  const WORKER_NAME = 'ddo-gg-queue-worker';

  const params = () => new URLSearchParams(location.search);

  const allowed = () =>
    window.__ddoToolbox?.isEnabled?.(ID) !== false;

  const productPage = () =>
    params().get('section') === 'products';

  const editId = () =>
    productPage() && params().get('action') === 'edit'
      ? params().get('id')
      : '';

  const listPage = () =>
    productPage() && params().get('action') !== 'edit';

  const boxes = () =>
    [...document.querySelectorAll(
      'input[type="checkbox"][name="products[]"]'
    )];

  const applicable = () =>
    allowed() && listPage() && boxes().length > 0;

  const send = (name, data) =>
    document.dispatchEvent(
      new CustomEvent(`ddo-toolbox:${name}`, {
        detail: JSON.stringify(data)
      })
    );

  const productUrl = id =>
    `${location.origin}/admin.php?section=products&action=edit&id=${encodeURIComponent(id)}`;

  const isWorker = () =>
    window.name === WORKER_NAME;

  const safe = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[char])
    );

  // =========================================================
  // STORAGE
  // =========================================================

  function state() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      console.error('[DDO GG Queue] State lezen mislukt', error);
      return null;
    }
  }

  function save(value) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    render();
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
    render();
  }

  function buildQueue() {
    try {
      const value = JSON.parse(
        localStorage.getItem(BUILD_KEY) || '[]'
      );

      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveBuildQueue(queue) {
    localStorage.setItem(
      BUILD_KEY,
      JSON.stringify(queue)
    );

    renderBuilder();
  }

  function clearBuildQueue() {
    localStorage.removeItem(BUILD_KEY);
    renderBuilder();
  }

  // =========================================================
  // TOOLBOX
  // =========================================================

  function report() {
    const ready = applicable();

    send('adapter-state', {
      id: ID,
      kind: 'feature',
      label: 'GG Queue',
      version: VERSION,
      updateUrl: UPDATE_URL,
      available: ready,
      ready,
      reason: ready
        ? 'Bouw of start een GoedGepickt queue'
        : 'Open een productlijst'
    });
  }

  // =========================================================
  // SELECTIE UITLEZEN
  // =========================================================

  function selected() {
    return boxes()
      .filter(box => box.checked)
      .map(box => {
        const row = box.closest('tr');
        const cells = [...(row?.querySelectorAll('td') || [])];

        return {
          id: String(box.value || '').trim(),
          name: String(cells[1]?.innerText || '')
            .trim()
            .split('\n')[0]
            .trim()
        };
      })
      .filter(item => /^\d+$/.test(item.id));
  }

  // =========================================================
  // QUEUE OPBOUWEN
  // =========================================================

  function mergeIntoBuildQueue(items) {
    const current = buildQueue();

    const ids = new Set(
      current.map(item => String(item.id))
    );

    let added = 0;
    let duplicates = 0;

    for (const item of items) {
      const id = String(item.id || '').trim();

      if (!/^\d+$/.test(id)) {
        continue;
      }

      if (ids.has(id)) {
        duplicates++;
        continue;
      }

      current.push({
        id,
        name: item.name || ''
      });

      ids.add(id);
      added++;
    }

    saveBuildQueue(current);

    return {
      added,
      duplicates,
      total: current.length
    };
  }

  function addSelectedToBuildQueue() {
    const items = selected();

    if (!items.length) {
      alert('Selecteer eerst minimaal één product.');
      return;
    }

    const result = mergeIntoBuildQueue(items);

    alert(
      `${result.added} product(en) toegevoegd.\n` +
      `${result.duplicates} dubbel(en) overgeslagen.\n\n` +
      `Queue bevat nu ${result.total} producten.`
    );
  }

  // =========================================================
  // PRODUCT ID IMPORT
  // =========================================================

  function importProductIds() {
    const input = prompt(
      'Plak Product ID\'s.\n\n' +
      'Je mag nieuwe regels, tabs, komma\'s, puntkomma\'s of spaties gebruiken.\n\n' +
      'Voorbeeld:\n' +
      '49777\n49778\n49779'
    );

    if (input === null) return;

    /*
     * We zoeken bewust naar losse cijferreeksen.
     * Daardoor werken:
     *
     * 49777
     * 49777, 49778
     * 49777\t49778
     *
     * maar óók volledige edit-URL's.
     */
    const matches = input.match(/\d+/g) || [];

    const items = matches
      .map(id => ({
        id: String(id),
        name: ''
      }))
      .filter(item => /^\d+$/.test(item.id));

    if (!items.length) {
      alert('Geen geldige Product ID\'s gevonden.');
      return;
    }

    const result = mergeIntoBuildQueue(items);

    alert(
      `${result.added} Product ID's toegevoegd.\n` +
      `${result.duplicates} dubbel(en) overgeslagen.\n\n` +
      `Queue bevat nu ${result.total} producten.`
    );
  }

  // =========================================================
  // QUEUE STARTEN
  // =========================================================

  function createRunningQueue(queue) {
    if (!queue.length) {
      alert('De queue is leeg.');
      return;
    }

    const current = state();

    if (
      current &&
      ['running', 'pushing', 'paused'].includes(current.status)
    ) {
      if (
        !confirm(
          'Er bestaat al een actieve GG Queue.\n\n' +
          'Wil je die vervangen?'
        )
      ) {
        return;
      }
    }

    sessionStorage.setItem(
      SOURCE_KEY,
      location.href
    );

    save({
      version: 1,
      status: 'running',
      queue,
      index: 0,

      currentId: null,
      currentName: '',

      lastSuccessId: null,
      lastSuccessName: '',

      startedAt: new Date().toISOString(),
      pushStartedAt: null,

      error: null
    });

    openCurrent();
  }

  // Oude functie:
  // huidige selectie direct starten.
  function start() {
    if (!applicable()) return;

    const queue = selected();

    if (!queue.length) {
      alert(
        'Selecteer eerst minimaal één product dat naar GoedGepickt moet.'
      );
      return;
    }

    createRunningQueue(queue);
  }

  function startBuildQueue() {
    const queue = buildQueue();

    if (!queue.length) {
      alert(
        'De opgebouwde queue is leeg.\n\n' +
        'Voeg eerst geselecteerde producten of Product ID\'s toe.'
      );
      return;
    }

    if (
      !confirm(
        `GoedGepickt Queue starten met ${queue.length} producten?`
      )
    ) {
      return;
    }

    createRunningQueue(queue);
  }

  // =========================================================
  // WORKER
  // =========================================================

  function openCurrent() {
    const current = state();

    if (!current || current.status !== 'running') return;

    if (current.index >= current.queue.length) {
      finish();
      return;
    }

    const product = current.queue[current.index];

    current.currentId = product.id;
    current.currentName = product.name || '';
    current.error = null;

    save(current);

    const target = productUrl(product.id);

    if (isWorker()) {
      location.href = target;
      return;
    }

    const worker = window.open(
      target,
      WORKER_NAME
    );

    if (!worker) {
      pause(
        'Het Queue-tabblad kon niet worden geopend. ' +
        'Sta pop-ups voor DDO toe en probeer opnieuw.'
      );
    }
  }

  function pause(message) {
    const current = state();

    if (!current) return;

    current.status = 'paused';

    current.error = {
      time: new Date().toISOString(),
      message
    };

    save(current);

    console.error(
      '[DDO GG Queue]',
      message
    );
  }

  function finish() {
    const current = state();

    if (!current) return;

    current.status = 'finished';
    current.currentId = null;
    current.currentName = '';
    current.pushStartedAt = null;

    save(current);
  }

  // =========================================================
  // PUSH
  // =========================================================

  function push() {
    const current = state();
    const pageId = editId();
    const expected = current?.queue?.[current.index];

    if (
      !current ||
      current.status !== 'running' ||
      !expected
    ) {
      return;
    }

    if (String(pageId) !== String(expected.id)) {
      pause(
        `Onverwacht product. Verwacht ${expected.id}, ` +
        `geopend ${pageId || 'onbekend'}.`
      );
      return;
    }

    const button = document.querySelector(
      'input[name="gg_product_add"],' +
      'button[name="gg_product_add"]'
    );

    if (!button) {
      pause(
        'De knop “Add product to WMS” is niet gevonden.'
      );
      return;
    }

    current.status = 'pushing';
    current.currentId = pageId;
    current.currentName = expected.name || '';
    current.pushStartedAt = new Date().toISOString();
    current.error = null;

    save(current);

    button.click();

    setTimeout(() => {
      const latest = state();

      if (
        latest?.status === 'pushing' &&
        String(latest.currentId) === String(pageId)
      ) {
        pause(
          'Geen succesvolle reload ontvangen binnen 90 seconden.'
        );
      }
    }, TIMEOUT);
  }

  function handleEdit() {
    const current = state();
    const pageId = editId();

    if (
      !isWorker() ||
      !current ||
      !pageId ||
      !allowed()
    ) {
      return;
    }

    const expected =
      current.queue?.[current.index];

    if (!expected) {
      finish();
      return;
    }

    /*
     * We waren aan het pushen en dezelfde pagina
     * is opnieuw geladen.
     *
     * Dat beschouwen we, net als in je huidige
     * script, als succesvolle push.
     */
    if (
      current.status === 'pushing' &&
      String(pageId) === String(current.currentId)
    ) {
      current.lastSuccessId = current.currentId;
      current.lastSuccessName = current.currentName;

      current.index++;

      current.currentId = null;
      current.currentName = '';
      current.pushStartedAt = null;
      current.error = null;

      if (current.index >= current.queue.length) {
        current.status = 'finished';
        save(current);
        return;
      }

      current.status = 'running';

      save(current);
      openCurrent();

      return;
    }

    if (
      current.status === 'running' &&
      String(pageId) === String(expected.id)
    ) {
      push();
      return;
    }

    if (
      ['running', 'pushing'].includes(current.status)
    ) {
      pause(
        `Onverwacht product. Verwacht ${expected.id}, ` +
        `geopend ${pageId}.`
      );
    }
  }

  // =========================================================
  // BEDIENING ACTIEVE QUEUE
  // =========================================================

  function retry() {
    const current = state();

    if (current?.status !== 'paused') return;

    const product =
      current.queue?.[current.index];

    if (!product) return;

    if (
      !confirm(
        `Product ${product.id} opnieuw proberen?\n\n` +
        'Controleer bij twijfel eerst of het al in GoedGepickt staat.'
      )
    ) {
      return;
    }

    current.status = 'running';
    current.pushStartedAt = null;
    current.error = null;

    save(current);

    if (isWorker()) {
      location.href = productUrl(product.id);
    } else {
      openCurrent();
    }
  }

  function skip() {
    const current = state();

    if (current?.status !== 'paused') return;

    const product =
      current.queue?.[current.index];

    if (
      !product ||
      !confirm(
        `Product ${product.id} overslaan?\n\n` +
        `${product.name || ''}`
      )
    ) {
      return;
    }

    current.index++;

    current.currentId = null;
    current.currentName = '';
    current.pushStartedAt = null;
    current.error = null;

    if (current.index >= current.queue.length) {
      current.status = 'finished';
      save(current);
    } else {
      current.status = 'running';
      save(current);
      openCurrent();
    }
  }

  function stop() {
    if (
      state() &&
      confirm(
        'GG Queue volledig stoppen en de voortgang wissen?'
      )
    ) {
      clear();
    }
  }

  // =========================================================
  // BUILDER PANEL
  // =========================================================

  function renderBuilder() {
    let panel =
      document.getElementById(BUILDER_ID);

    if (
      !allowed() ||
      !listPage() ||
      !boxes().length
    ) {
      panel?.remove();
      return;
    }

    const queue = buildQueue();

    if (!panel) {
      panel = document.createElement('aside');
      panel.id = BUILDER_ID;

      panel.style.cssText = `
        position:fixed;
        right:10px;
        top:10px;
        width:210px;
        z-index:99999997;
        background:#fff;
        color:#25313b;
        border:1px solid #cbd5df;
        border-radius:7px;
        box-shadow:0 5px 18px #0002;
        font:11px/1.3 system-ui;
        overflow:hidden;
      `;

      document.body.append(panel);
    }

    panel.innerHTML = `
      <header style="
        padding:7px 9px;
        background:#263746;
        color:#fff;
        font-weight:650
      ">
        GG Queue Builder
      </header>

      <div style="padding:9px">

        <div style="
          margin-bottom:8px;
          color:#63717c
        ">
          Opgebouwde queue
        </div>

        <strong style="
          font-size:20px;
          display:block;
          margin-bottom:9px
        ">
          ${queue.length}
        </strong>

        <button data-b="add">
          + Selectie toevoegen
        </button>

        <button data-b="import">
          Product ID's plakken
        </button>

        <button data-b="start"
          ${queue.length ? '' : 'disabled'}>
          ▶ Start queue
        </button>

        <button data-b="clear"
          ${queue.length ? '' : 'disabled'}>
          Queue wissen
        </button>

      </div>
    `;

    panel
      .querySelectorAll('button')
      .forEach(button => {
        button.style.cssText = `
          display:block;
          width:100%;
          border:0;
          border-radius:4px;
          padding:6px 8px;
          margin-top:5px;
          background:#0877b9;
          color:#fff;
          font:600 10px system-ui;
          cursor:pointer;
        `;

        if (button.disabled) {
          button.style.opacity = '.4';
          button.style.cursor = 'default';
        }
      });

    panel
      .querySelector('[data-b="add"]')
      ?.addEventListener(
        'click',
        addSelectedToBuildQueue
      );

    panel
      .querySelector('[data-b="import"]')
      ?.addEventListener(
        'click',
        importProductIds
      );

    panel
      .querySelector('[data-b="start"]')
      ?.addEventListener(
        'click',
        startBuildQueue
      );

    panel
      .querySelector('[data-b="clear"]')
      ?.addEventListener(
        'click',
        () => {
          if (
            queue.length &&
            confirm(
              `Opgebouwde queue met ${queue.length} producten wissen?`
            )
          ) {
            clearBuildQueue();
          }
        }
      );
  }

  // =========================================================
  // ACTIEVE QUEUE PANEL
  // =========================================================

  function render() {
    let panel =
      document.getElementById(PANEL_ID);

    const current = state();

    /*
     * Builder blijft op iedere productlijst zichtbaar.
     * Actieve queue-paneel mag eveneens zichtbaar blijven
     * terwijl we door de productlijsten navigeren.
     */
    const visible =
      isWorker() || listPage();

    if (!current || !visible) {
      panel?.remove();
      renderBuilder();
      return;
    }

    if (!panel) {
      panel = document.createElement('aside');
      panel.id = PANEL_ID;

      panel.style.cssText = `
        position:fixed;
        right:235px;
        top:10px;
        width:245px;
        z-index:99999998;
        background:#fff;
        color:#25313b;
        border:1px solid #cbd5df;
        border-radius:7px;
        box-shadow:0 5px 18px #0002;
        font:11px/1.3 system-ui;
        overflow:hidden;
      `;

      document.body.append(panel);
    }

    const total =
      current.queue?.length || 0;

    const done =
      Math.min(current.index || 0, total);

    const item =
      current.queue?.[current.index];

    const labels = {
      running: 'Product openen',
      pushing: 'Bezig met pushen…',
      paused: 'Gepauzeerd',
      finished: 'Klaar'
    };

    const error =
      current.error?.message
        ? `
          <div style="
            margin-top:7px;
            padding:6px;
            background:#fff0f0;
            color:#a61b1b;
            border-radius:4px
          ">
            ${safe(current.error.message)}
          </div>
        `
        : '';

    const controls =
      current.status === 'paused'
        ? `
          <button data-q="retry">Opnieuw</button>
          <button data-q="skip">Overslaan</button>
          <button data-q="stop">Stop</button>
        `
        : current.status === 'finished'
          ? `
            <button data-q="clear">
              Sluiten / wissen
            </button>
          `
          : `
            <button data-q="stop">
              Stop
            </button>
          `;

    panel.innerHTML = `
      <header style="
        padding:7px 9px;
        background:#263746;
        color:#fff;
        font-weight:650
      ">
        GoedGepickt Queue
      </header>

      <div style="padding:9px">

        <strong style="font-size:16px">
          ${done} / ${total}
        </strong>

        <div style="color:#63717c">
          ${labels[current.status] || safe(current.status)}
        </div>

        ${
          item
            ? `
              <div style="
                margin-top:7px;
                padding:6px;
                background:#f4f7f9;
                border-radius:4px
              ">
                <b>${safe(item.id)}</b>
                ${
                  item.name
                    ? `<br>${safe(item.name)}`
                    : ''
                }
              </div>
            `
            : ''
        }

        ${error}

        <div style="
          display:flex;
          gap:5px;
          flex-wrap:wrap;
          margin-top:8px
        ">
          ${controls}
        </div>

      </div>
    `;

    panel
      .querySelectorAll('button')
      .forEach(button => {
        button.style.cssText = `
          border:0;
          border-radius:4px;
          padding:5px 8px;
          background:#0877b9;
          color:#fff;
          font:600 10px system-ui;
          cursor:pointer;
        `;
      });

    panel
      .querySelector('[data-q="retry"]')
      ?.addEventListener('click', retry);

    panel
      .querySelector('[data-q="skip"]')
      ?.addEventListener('click', skip);

    panel
      .querySelector('[data-q="stop"]')
      ?.addEventListener('click', stop);

    panel
      .querySelector('[data-q="clear"]')
      ?.addEventListener('click', clear);

    renderBuilder();
  }

  // =========================================================
  // EVENTS
  // =========================================================

  document.addEventListener(
    'ddo-toolbox:discover',
    report
  );

  /*
   * De bestaande Toolbox-knop behoudt zijn oude gedrag:
   * geselecteerde producten direct starten.
   */
  document.addEventListener(
    'ddo-toolbox:run-feature',
    event => {
      let detail = {};

      try {
        detail = JSON.parse(event.detail || '{}');
      } catch {}

      if (detail.id === ID) {
        start();
      }
    }
  );

  window.addEventListener(
    'storage',
    event => {
      if (event.key === STORAGE_KEY) {
        render();
      }

      if (event.key === BUILD_KEY) {
        renderBuilder();
      }
    }
  );

  report();
  render();
  renderBuilder();

  if (editId()) {
    handleEdit();
  }
})();
