// ==UserScript==
// @name         GG | Paste2Order Tag Worker
// @namespace    https://dutchdesignersoutlet.com/
// @version      0.2
// @description  Verwerkt Paste2Order-tags en verwijdert conflicterende tags.
// @match        https://fm-e-warehousing.goedgepickt.nl/orders/view/*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/hosted/2order/p2o-tag-worker.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/hosted/2order/p2o-tag-worker.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const HASH_PREFIX = 'paste2order-add-tag=';

  const TAG_EXTERN = 'extern';
  const TAG_GEPRINT = 'geprint_extern';
  const TAG_BESTELD = 'besteld';

  const DEFAULT_TAG_SLUG = TAG_GEPRINT;
  const STATUS_ID = 'paste2order-tag-status';

  function getRequest() {
    const hash = decodeURIComponent(location.hash || '').replace(/^#/, '');
    if (!hash) return null;

    const params = new URLSearchParams(hash);

    const slug =
      params.get('paste2order-add-tag') ||
      (hash.startsWith(HASH_PREFIX)
        ? hash.slice(HASH_PREFIX.length)
        : '');

    if (!slug) return null;

    return {
      slug: slug.trim() || DEFAULT_TAG_SLUG,
      label: (params.get('label') || '').trim(),
      queue: (params.get('queue') || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
      total: parseInt(params.get('total') || '0', 10) || 0
    };
  }

  function waitFor(selector, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);

      if (existing) {
        resolve(existing);
        return;
      }

      const started = Date.now();

      const timer = setInterval(() => {
        const element = document.querySelector(selector);

        if (element) {
          clearInterval(timer);
          resolve(element);
          return;
        }

        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`Element niet gevonden: ${selector}`));
        }
      }, 150);
    });
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitUntil(predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (predicate()) {
        resolve(true);
        return;
      }

      const started = Date.now();

      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve(true);
          return;
        }

        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error('Timeout tijdens wachten op paginastatus.'));
        }
      }, 100);
    });
  }

  function isClickable(element) {
    if (!element || element.disabled) return false;

    const style = getComputedStyle(element);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.pointerEvents === 'none'
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();

    return rect.width > 0 && rect.height > 0;
  }

  function humanClick(element) {
    element.scrollIntoView({
      block: 'center',
      inline: 'center'
    });

    ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => {
      element.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
    });
  }

  function setStatus(message, state = 'info') {
    let status = document.getElementById(STATUS_ID);

    if (!status) {
      status = document.createElement('div');
      status.id = STATUS_ID;

      status.style.cssText = [
        'position:fixed',
        'right:14px',
        'bottom:14px',
        'z-index:999999',
        'padding:8px 10px',
        'border-radius:6px',
        'font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif',
        'box-shadow:0 8px 24px rgba(0,0,0,.2)',
        'background:#fff',
        'color:#1f2933',
        'border:1px solid #d1d5db'
      ].join(';');

      document.body.appendChild(status);
    }

    status.textContent = message;

    status.style.borderColor =
      state === 'error'
        ? '#dc2626'
        : state === 'ok'
          ? '#16a34a'
          : '#d1d5db';
  }

  function getTagLabel(request) {
    if (request.label) {
      return request.label;
    }

    if (request.slug === TAG_BESTELD) {
      return 'EXT Besteld';
    }

    if (request.slug === TAG_GEPRINT) {
      return 'EXT Print';
    }

    return request.slug;
  }

  function isTagSelected(tagElement) {
    const check = tagElement.querySelector('.check');

    if (!check) return false;

    const style = getComputedStyle(check);

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  function clearHash() {
    history.replaceState(
      null,
      document.title,
      location.pathname + location.search
    );
  }

  function getCurrentUuid() {
    const parts = location.pathname
      .split('/')
      .filter(Boolean);

    return parts[parts.length - 1] || '';
  }

  function getNextUrl(request) {
    if (!request.queue.length) return '';

    const nextUuid = request.queue[0];
    const remaining = request.queue.slice(1);

    const params = new URLSearchParams();

    params.set('paste2order-add-tag', request.slug);

    if (request.label) {
      params.set('label', request.label);
    }

    if (remaining.length) {
      params.set('queue', remaining.join(','));
    }

    if (request.total) {
      params.set('total', String(request.total));
    }

    return (
      `${location.origin}/orders/view/${encodeURIComponent(nextUuid)}` +
      `#${params.toString()}`
    );
  }

  function closeModalIfPresent() {
    const closeButton = document.querySelector(
      '.modal.show .close, .modal .close, [data-dismiss="modal"]'
    );

    if (closeButton && isClickable(closeButton)) {
      humanClick(closeButton);
    }
  }

  function getCsrfToken(doc = document) {
    const meta = doc.querySelector('meta[name="csrf-token"]');

    if (meta?.content) {
      return meta.content;
    }

    const input = doc.querySelector('input[name="_token"]');

    if (input?.value) {
      return input.value;
    }

    const html = doc.documentElement?.innerHTML || '';

    const match =
      html.match(/csrf-token["'][^>]+content=["']([^"']+)/i) ||
      html.match(/name=["']_token["'][^>]+value=["']([^"']+)/i);

    return match ? match[1] : '';
  }

  function getTagSelector(slug) {
    if (window.CSS && CSS.escape) {
      return `.tag-toggler[data-slug="${CSS.escape(slug)}"]`;
    }

    const safeSlug = String(slug)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');

    return `.tag-toggler[data-slug="${safeSlug}"]`;
  }

  function getAllUuids(request) {
    const seen = new Set();

    return [getCurrentUuid(), ...request.queue]
      .map(uuid => (uuid || '').trim())
      .filter(Boolean)
      .filter(uuid => {
        if (seen.has(uuid)) {
          return false;
        }

        seen.add(uuid);
        return true;
      });
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function getParsedTagElement(doc, slug) {
    return doc.querySelector(getTagSelector(slug));
  }

  function isParsedTagSelected(doc, slug) {
    const tag = getParsedTagElement(doc, slug);

    if (!tag) {
      throw new Error(`Tag niet gevonden: ${slug}`);
    }

    const check = tag.querySelector('.check');

    if (!check) {
      return false;
    }

    const style = (check.getAttribute('style') || '').toLowerCase();

    return !/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/.test(
      style
    );
  }

  function isParsedTagSelectedIfPresent(doc, slug) {
    const tag = getParsedTagElement(doc, slug);

    if (!tag) {
      console.warn(
        `[Paste2Order tagger] Tag niet gevonden en overgeslagen: ${slug}`
      );

      return false;
    }

    const check = tag.querySelector('.check');

    if (!check) {
      return false;
    }

    const style = (check.getAttribute('style') || '').toLowerCase();

    return !/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/.test(
      style
    );
  }

  async function fetchOrderDocument(uuid) {
    if (uuid === getCurrentUuid()) {
      return document;
    }

    const response = await fetch(
      `${location.origin}/orders/view/${encodeURIComponent(uuid)}`,
      {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store'
      }
    );

    if (!response.ok) {
      throw new Error(`Order ophalen mislukt (${response.status})`);
    }

    return parseHtml(await response.text());
  }

  async function postTag(uuid, slug, csrfToken) {
    const body = new URLSearchParams();

    body.set('_token', csrfToken);
    body.append('tags[]', slug);

    const response = await fetch(
      `${location.origin}/settings/tags/0/${encodeURIComponent(uuid)}/toggle`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: '*/*',
          'Content-Type':
            'application/x-www-form-urlencoded; charset=UTF-8',
          'X-CSRF-TOKEN': csrfToken,
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: body.toString()
      }
    );

    let payload = null;

    try {
      payload = await response.clone().json();
    } catch {
      payload = await response.text();
    }

    if (!response.ok || payload?.success === false) {
      throw new Error(
        `Tag ${slug} opslaan mislukt (${response.status})`
      );
    }

    return payload;
  }

  function getConflictingTag(slug) {
    if (slug === TAG_GEPRINT) {
      return TAG_EXTERN;
    }

    if (slug === TAG_BESTELD) {
      return TAG_GEPRINT;
    }

    return '';
  }

  async function removeTagIfSelected(
    uuid,
    slug,
    csrfToken,
    orderDocument
  ) {
    if (!isParsedTagSelectedIfPresent(orderDocument, slug)) {
      return false;
    }

    setStatus(`Paste2Order: tag ${slug} verwijderen...`);

    await postTag(uuid, slug, csrfToken);

    console.log(
      `[Paste2Order tagger] Tag verwijderd: ${slug}`,
      uuid
    );

    return true;
  }

  async function closeWorkerTabAfterSuccess() {
    await wait(600);

    window.close();

    setStatus(
      'Paste2Order: klaar. Dit tabblad mag dicht.',
      'ok'
    );
  }

  function showFailureReport(results) {
    const failedList = results.failed
      .map(item => `${item.uuid}: ${item.message}`)
      .join('\n');

    setStatus(
      `Paste2Order: klaar met fouten. ` +
      `${results.added} toegevoegd, ` +
      `${results.removed} verwijderd, ` +
      `${results.skipped} al aanwezig, ` +
      `${results.failed.length} fout. Zie console.`,
      'error'
    );

    console.error(
      '[Paste2Order tagger] Foutenrapport:\n' + failedList,
      results.failed
    );
  }

  async function addTagsDirect(request) {
    const uuids = getAllUuids(request);
    const csrfToken = getCsrfToken();

    const results = {
      added: 0,
      skipped: 0,
      removed: 0,
      failed: []
    };

    const label = getTagLabel(request);

    if (!csrfToken) {
      throw new Error(
        'CSRF-token niet gevonden op de GoedGepickt-pagina.'
      );
    }

    if (!uuids.length) {
      setStatus(
        'Paste2Order: geen order-UUID gevonden.',
        'error'
      );

      return;
    }

    for (let index = 0; index < uuids.length; index += 1) {
      const uuid = uuids[index];
      const progress = `(${index + 1}/${uuids.length})`;

      try {
        setStatus(
          `Paste2Order: ${label} controleren ${progress}...`
        );

        const orderDocument = await fetchOrderDocument(uuid);

        if (isParsedTagSelected(orderDocument, request.slug)) {
          results.skipped += 1;

          setStatus(
            `Paste2Order: ${label} stond al aan ${progress}.`,
            'ok'
          );
        } else {
          setStatus(
            `Paste2Order: ${label} opslaan ${progress}...`
          );

          await postTag(
            uuid,
            request.slug,
            csrfToken
          );

          results.added += 1;

          setStatus(
            `Paste2Order: ${label} toegevoegd ${progress}.`,
            'ok'
          );
        }

        const conflictingTag = getConflictingTag(request.slug);

        if (conflictingTag) {
          const removed = await removeTagIfSelected(
            uuid,
            conflictingTag,
            csrfToken,
            orderDocument
          );

          if (removed) {
            results.removed += 1;

            setStatus(
              `Paste2Order: ${label} toegevoegd en ` +
              `${conflictingTag} verwijderd ${progress}.`,
              'ok'
            );
          }
        }

        await wait(150);
      } catch (error) {
        console.error(
          '[Paste2Order tagger]',
          uuid,
          error
        );

        results.failed.push({
          uuid,
          message: error?.message || String(error)
        });

        setStatus(
          `Paste2Order: fout bij ${uuid}. ` +
          'Ga door met de rest.',
          'error'
        );
      }
    }

    clearHash();

    if (results.failed.length) {
      showFailureReport(results);
      return;
    }

    setStatus(
      `Paste2Order: klaar met ${label}. ` +
      `${results.added} toegevoegd, ` +
      `${results.removed} verwijderd, ` +
      `${results.skipped} al aanwezig. ` +
      'Tabblad sluit zo.',
      'ok'
    );

    await closeWorkerTabAfterSuccess();
  }

  async function goToNextOrFinish(request) {
    const nextUrl = getNextUrl(request);

    if (nextUrl) {
      await wait(900);
      location.assign(nextUrl);
      return;
    }

    closeModalIfPresent();
    clearHash();
  }

  async function addTag(request) {
    const processed = request.total
      ? request.total - request.queue.length
      : 1;

    const progress = request.total
      ? ` (${processed}/${request.total})`
      : '';

    const label = getTagLabel(request);

    setStatus(
      `Paste2Order: ${label} toevoegen${progress}...`
    );

    const manageButton = await waitFor('#manageTagsButton');
    humanClick(manageButton);

    const tag = await waitFor(
      getTagSelector(request.slug)
    );

    if (isTagSelected(tag)) {
      setStatus(
        `Paste2Order: ${label} stond al op deze order${progress}.`,
        'ok'
      );

      await goToNextOrFinish(request);
      return;
    }

    humanClick(tag);

    await waitUntil(() => isTagSelected(tag));

    const saveButton = await waitFor('#saveTagsButton');

    await waitUntil(() => isClickable(saveButton));
    await wait(250);

    humanClick(saveButton);

    setStatus(
      `Paste2Order: ${label} toegevoegd${progress}.`,
      'ok'
    );

    await wait(900);
    await goToNextOrFinish(request);
  }

  const request = getRequest();

  if (!request) {
    return;
  }

  addTagsDirect(request).catch(error => {
    console.error(
      '[Paste2Order tagger]',
      error
    );

    setStatus(
      `Paste2Order: tag toevoegen mislukt op ` +
      `${getCurrentUuid()}. Zie console.`,
      'error'
    );
  });
})();
