// ==UserScript==
// @name         DDO | Inject Size Chart HTML
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.2
// @description  Injecteert vaste size chart HTML in de sizechart editors van NL/EN/DE/FR
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=brands&action=edit&id=*
// @grant        none
// @author       C. P. van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/inject-size-chart-html.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/inject-size-chart-html.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SELECTORS = {
    nl: 'textarea[name="sizechart"]',
    en: 'textarea[name="lang[en][sizechart]"]',
    de: 'textarea[name="lang[de][sizechart]"]',
    fr: 'textarea[name="lang[fr][sizechart]"]'
  };

  function getBrandName() {
    const input =
      document.querySelector('input[name="name"]') ||
      document.querySelector('input[name="title"]');

    return input?.value?.trim() || '';
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function htmlByLang(lang, brandName) {
    const brand = esc(brandName);

    const map = {
      nl: `<p><span>Omdat geen enkel merk hetzelfde valt, kunnen pasvorm en maat per model verschillen. Met onze tips, de&nbsp;</span><span><a href="/klantenservice/maattabel/bh-maat-berekentool">bh-maat berekentool</a></span><span>&nbsp;en een duidelijk overzicht met&nbsp;</span><span><a href="/klantenservice/maattabel">alle maattabellen</a></span><span>&nbsp;helpen we je de juiste maat te kiezen. Zo bestel je met vertrouwen wat bij je past.</span></p>
<p>Voor het merk <span>${brand}</span> hebben we geen specifieke maattabel. Je kunt uitgaan van een standaard maatvoering.</p>`,

      en: `<p><span>Because not every brand fits the same, the fit and size may vary per model. With our tips, the&nbsp;</span><span><a href="/klantenservice/maattabel/bh-maat-berekentool">bra size calculator</a></span><span>&nbsp;and a clear overview with&nbsp;</span><span><a href="/klantenservice/maattabel">all size charts</a></span><span>&nbsp;we help you choose the right size. This way you can order with confidence what suits you best.</span></p>
<p>For the brand <span>${brand}</span> we do not have a specific size chart. You can rely on standard sizing.</p>`,

      de: `<p><span>Da nicht jede Marke gleich ausfällt, können Passform und Größe je nach Modell variieren. Mit unseren Tipps, dem&nbsp;</span><span><a href="/klantenservice/maattabel/bh-maat-berekentool">BH-Größenrechner</a></span><span>&nbsp;und einer klaren Übersicht mit&nbsp;</span><span><a href="/klantenservice/maattabel">allen Größentabellen</a></span><span>&nbsp;helfen wir dir, die richtige Größe zu wählen. So bestellst du mit Vertrauen das, was zu dir passt.</span></p>
<p>Für die Marke <span>${brand}</span> haben wir keine spezifische Größentabelle. Du kannst von einer Standardgrößenführung ausgehen.</p>`,

      fr: `<p><span>Comme chaque marque taille différemment, la coupe et la taille peuvent varier selon le modèle. Grâce à nos conseils, au&nbsp;</span><span><a href="/klantenservice/maattabel/bh-maat-berekentool">calculateur de taille de soutien-gorge</a></span><span>&nbsp;et à un aperçu clair de&nbsp;</span><span><a href="/klantenservice/maattabel">tous les tableaux de tailles</a></span><span>&nbsp;nous vous aidons à choisir la bonne taille. Vous pouvez ainsi commander en toute confiance ce qui vous convient le mieux.</span>
// @author       C. P. van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/compo-link-list.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/compo-link-list.user.js</p>
<p>Pour la marque <span>${brand}</span> nous ne disposons pas d’un tableau de tailles spécifique. Vous pouvez vous baser sur une taille standard.</p>`
    };

    return map[lang];
  }

  function triggerNativeEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function findTinyEditorForTextarea(textarea) {
    if (!window.tinyMCE && !window.tinymce) return null;

    const tm = window.tinyMCE || window.tinymce;
    const editors = tm.editors || [];

    for (const editor of editors) {
      try {
        if (!editor) continue;

        if (editor.targetElm === textarea) return editor;
        if (typeof editor.getElement === 'function' && editor.getElement() === textarea) return editor;
        if (editor.id && textarea.id && editor.id === textarea.id) return editor;

        const targetName =
          editor.targetElm?.name ||
          (typeof editor.getElement === 'function' ? editor.getElement()?.name : '');

        if (targetName && targetName === textarea.name) return editor;
      } catch (e) {
        // negeren
      }
    }

    return null;
  }

  function setTextareaAndEditor(textarea, html) {
    if (!textarea) return false;

    // Altijd de echte textarea vullen
    textarea.value = html;
    triggerNativeEvents(textarea);

    // Daarna TinyMCE syncen als er een editor op hangt
    const editor = findTinyEditorForTextarea(textarea);

    if (editor) {
      try {
        if (typeof editor.setContent === 'function') {
          editor.setContent(html);
        }

        if (typeof editor.save === 'function') {
          editor.save();
        }

        const sourceEl =
          editor.targetElm ||
          (typeof editor.getElement === 'function' ? editor.getElement() : null);

        if (sourceEl && sourceEl !== textarea) {
          sourceEl.value = html;
          triggerNativeEvents(sourceEl);
        }

        // extra fallback voor oudere TinyMCE varianten
        const iframe = document.getElementById(editor.id + '_ifr');
        const iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
        const body = iframeDoc?.body;

        if (body && !body.innerHTML.trim()) {
          body.innerHTML = html;
        }
      } catch (err) {
        console.warn('TinyMCE sync fout:', err);
      }
    }

    return true;
  }

  function injectAll() {
    const brandName = getBrandName();

    const fields = {
      nl: document.querySelector(SELECTORS.nl),
      en: document.querySelector(SELECTORS.en),
      de: document.querySelector(SELECTORS.de),
      fr: document.querySelector(SELECTORS.fr)
    };

    let done = 0;

    for (const lang of ['nl', 'en', 'de', 'fr']) {
      if (fields[lang]) {
        setTextareaAndEditor(fields[lang], htmlByLang(lang, brandName));
        done++;
      } else {
        console.warn('Veld niet gevonden voor taal:', lang, SELECTORS[lang]);
      }
    }

    showToast(done ? `Size chart ingevuld (${done} velden)` : 'Geen sizechart velden gevonden');
  }

  function showToast(message) {
    const old = document.getElementById('ddo-sizechart-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'ddo-sizechart-toast';
    toast.textContent = message;
    toast.style.cssText = [
      'position:fixed',
      'right:20px',
      'bottom:80px',
      'z-index:999999',
      'background:#222',
      'color:#fff',
      'padding:10px 14px',
      'border-radius:8px',
      'font-size:13px',
      'box-shadow:0 4px 16px rgba(0,0,0,.25)'
    ].join(';');

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  function addButton() {
    if (document.getElementById('ddo-inject-sizechart-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'ddo-inject-sizechart-btn';
    btn.type = 'button';
    btn.textContent = 'Inject size chart';
    btn.style.cssText = [
      'position:fixed',
      'right:20px',
      'bottom:20px',
      'z-index:999999',
      'padding:12px 16px',
      'border:0',
      'border-radius:10px',
      'background:#2b6cb0',
      'color:#fff',
      'font-size:14px',
      'font-weight:700',
      'cursor:pointer',
      'box-shadow:0 6px 20px rgba(0,0,0,.18)'
    ].join(';');

    btn.addEventListener('click', injectAll);
    document.body.appendChild(btn);
  }

  function init() {
    addButton();
  }

  window.addEventListener('load', () => {
    setTimeout(init, 800);
  });
})();
