// ==UserScript==
// @name         DDO | Workspace
// @namespace    https://dutchdesignersoutlet.com/
// @version      3.0.0
// @description  Klantberichten maken vanuit een geopende GoedGepickt-order.
// @match        https://fm-e-warehousing.goedgepickt.nl/orders/view/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      www.dutchdesignersoutlet.com
// @run-at       document-idle
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/workflow.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/workflow.user.js
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self || document.querySelector('#ddo-workspace-host')) return;

  const ACTIONS = {
    uncollected: {
      label: 'Niet afgehaald', icon: '↩', description: 'Pakket is niet binnen de bewaartermijn afgehaald.',
      fields: [{ id: 'paymentUrl', label: 'Betaallink', placeholder: 'https://...' }],
      subject: (o, lang) => ({nl:`Bestelling ${o.orderId} niet afgehaald`,en:`Order ${o.orderId} not collected`,de:`Bestellung ${o.orderId} nicht abgeholt`,fr:`Commande ${o.orderId} non retirée`}[baseLang(lang)]),
      html: (o, v, lang) => localizedHtml(lang, code => uncollectedHtml(code, o, v))
    },
    tracking: {
      label: 'T&T buitenland', icon: '◎', description: 'Deel de internationale tracking met de klant.',
      fields: [],
      subject: (o, lang) => ({nl:`Je bestelling ${o.orderId} is onderweg`,en:`Your order ${o.orderId} is on its way`,de:`Ihre Bestellung ${o.orderId} ist unterwegs`,fr:`Votre commande ${o.orderId} est en route`}[baseLang(lang)]),
      html: (o, v, lang) => localizedHtml(lang, code => trackingHtml(code, o, v))
    },
    dpdInvestigation: {
      label: 'DPD Onderzoek', icon: '⌕', description: 'Start een onderzoek naar een niet ontvangen pakket.',
      language: 'nl', recipient: 'customerservice@dpd.nl', attachment: 'invoice',
      scenarios: [{ id: 'deliveredMissing', label: 'Bezorgd, niet ontvangen' }],
      fields: [],
      subject: o => `Pakket ${o.tracking || '$tracking'} (eigen ref: ${o.orderId || '$orderID'})`,
      html: o => `<p>Beste,</p><p>Pakket ${escapeHtml(o.tracking || '$tracking')} (eigen ref: ${escapeHtml(o.orderId || '$orderID')}) is volgens de tracking bezorgd, echter niet bij consument. Het pakket bleek ook niet af te halen bij de buren. Graag verneem ik waar dit pakket feitelijk is.</p><p>Factuur in bijlage. Zending betreft dames ondermode verzonden in een neutrale bruine vouwdoos.</p>`
    }
  };

  const LANGUAGE_LABELS = { nl: 'NL', en: 'EN', de: 'DE', fr: 'FR', nlfr: 'NL + FR' };
  const REVIEWS = {nl:'https://dashboard.webwinkelkeur.nl/reviews/add/1203386?r=5&lang=nld',en:'https://dashboard.webwinkelkeur.nl/reviews/add/1203386?r=5&lang=eng',de:'https://dashboard.webwinkelkeur.nl/reviews/add/1203386?r=5&lang=deu',fr:'https://dashboard.webwinkelkeur.nl/reviews/add/1203386?r=5&lang=eng'};
  function baseLang(lang) { return lang === 'nlfr' ? 'nl' : lang; }
  function localizedHtml(lang, create) { return lang === 'nlfr' ? `${create('nl')}<hr class="language-divider">${create('fr')}` : create(lang); }
  function uncollectedHtml(lang, o, v) {
    const t={nl:{dear:'Beste',received:'Zojuist ontvingen wij uw bestelling met ordernummer',reason:'retour. Deze is niet afgehaald bij het pakketpunt. Hiervoor worden aan ons helaas kosten doorberekend, à € 12,64.',choice:'Indien u de bestelling alsnog wenst te ontvangen, verzoeken wij u dat bedrag te voldoen middels onderstaande betaallink. Wenst u van de bestelling af te zien, dan zullen wij na aftrek van de genoemde kosten, het retourbedrag zo snel mogelijk aan u terugbetalen.',payment:'De betaallink'},en:{dear:'Dear',received:'We have just received your order with order number',reason:'back. It was not collected from the parcel point. Unfortunately, we are charged €12.64 for this.',choice:'If you would still like to receive the order, please pay this amount using the payment link below. If you no longer wish to receive the order, we will refund the return amount to you as soon as possible after deducting the costs mentioned above.',payment:'Payment link'},de:{dear:'Guten Tag',received:'Soeben haben wir Ihre Bestellung mit der Bestellnummer',reason:'zurückerhalten. Sie wurde nicht bei der Abholstation abgeholt. Dafür werden uns leider Kosten in Höhe von 12,64 € berechnet.',choice:'Wenn Sie die Bestellung weiterhin erhalten möchten, bitten wir Sie, diesen Betrag über den unten stehenden Zahlungslink zu begleichen. Wenn Sie von der Bestellung absehen möchten, erstatten wir Ihnen den Retourenbetrag nach Abzug der genannten Kosten so schnell wie möglich zurück.',payment:'Zahlungslink'},fr:{dear:'Bonjour',received:'Nous venons de recevoir en retour votre commande portant le numéro',reason:'. Celle-ci n’a pas été retirée au point relais. Des frais de 12,64 € nous sont malheureusement facturés.',choice:'Si vous souhaitez tout de même recevoir votre commande, nous vous prions de régler ce montant au moyen du lien de paiement ci-dessous. Si vous préférez renoncer à la commande, nous vous rembourserons le montant du retour dans les meilleurs délais, après déduction des frais mentionnés.',payment:'Lien de paiement'}}[lang];
    return `<p>${t.dear} ${escapeHtml(o.firstName)},</p><p>${t.received} ${escapeHtml(o.orderId || '')} ${t.reason}</p><p>${t.choice}</p><p>${t.payment}: ${linkHtml(v.paymentUrl, v.paymentUrl || '$URL')}</p>`;
  }
  function trackingHtml(lang,o,v){
    const t={nl:{dear:'Beste',sent:'Jouw bestelling is de deur uit en naar je onderweg!',order:'Pakketnummer',track:'Track & Trace',body:'We gaan ervan uit dat de levering keurig verloopt en dat de inhoud naar wens is. Mocht er onverhoopt toch iets mis zijn met de ontvangen artikelen, reageer dan binnen 24 uur na ontvangst op dit bericht en vertel ons wat het probleem is. Je mag foto\'s meesturen als die extra verduidelijking geven. We proberen het probleem zo snel mogelijk met je op te lossen.',question:'Hoe was je ervaring?',thanks:'Nogmaals bedankt voor je bestelling! Wil je ons en onze website een',review:'waardering geven',end:'? Zo kunnen wij en toekomstige klanten van jouw ervaring leren.'},en:{dear:'Dear',sent:'Your order has left our warehouse and is on its way to you!',order:'Parcel number',track:'Track & Trace',body:'We expect the delivery to go smoothly and hope everything is to your satisfaction. If anything is unexpectedly wrong with the items you receive, please reply to this message within 24 hours of delivery and tell us what the problem is. Feel free to include photos if they help clarify the issue. We will try to resolve it with you as quickly as possible.',question:'How was your experience?',thanks:'Thank you again for your order! Would you like to',review:'rate us and our website',end:'? This helps us and future customers learn from your experience.'},de:{dear:'Hallo',sent:'Ihre Bestellung hat unser Lager verlassen und ist auf dem Weg zu Ihnen!',order:'Paketnummer',track:'Sendungsverfolgung',body:'Wir gehen davon aus, dass die Lieferung reibungslos verläuft und alles zu Ihrer Zufriedenheit ist. Sollte mit den erhaltenen Artikeln wider Erwarten etwas nicht stimmen, antworten Sie bitte innerhalb von 24 Stunden nach Erhalt auf diese Nachricht und schildern Sie uns das Problem. Sie können gerne Fotos mitsenden, wenn diese zur Klärung beitragen. Wir werden versuchen, das Problem so schnell wie möglich gemeinsam mit Ihnen zu lösen.',question:'Wie war Ihre Erfahrung?',thanks:'Nochmals vielen Dank für Ihre Bestellung! Möchten Sie',review:'uns und unsere Website bewerten',end:'? So können wir und zukünftige Kunden von Ihrer Erfahrung lernen.'},fr:{dear:'Bonjour',sent:'Votre commande a quitté notre entrepôt et est en route vers vous !',order:'Numéro de colis',track:'Suivi du colis',body:'Nous partons du principe que la livraison se déroulera sans problème et que le contenu vous donnera entière satisfaction. Si toutefois un article reçu présentait un problème, veuillez répondre à ce message dans les 24 heures suivant la réception en nous expliquant la situation. Vous pouvez joindre des photos si elles permettent de mieux comprendre le problème. Nous ferons notre possible pour le résoudre avec vous dans les meilleurs délais.',question:'Comment s’est passée votre expérience ?',thanks:'Merci encore pour votre commande ! Souhaitez-vous',review:'évaluer notre boutique en ligne',end:' ? Votre avis nous aide, ainsi que nos futurs clients, à tirer parti de votre expérience.'}}[lang];
    return `<p>${t.dear} ${escapeHtml(o.firstName)},</p><p>${t.sent}</p><p><strong>${t.order}:</strong> #${escapeHtml(o.orderId||'')}<br><strong>${t.track}:</strong> ${linkHtml(v.trackingUrl,v.tracking||'$tracking')}</p><p>${t.body}</p><p><span class="stars">★★★★★</span><br><strong>${t.question}</strong><br>${t.thanks} <a href="${REVIEWS[lang]}" target="_blank" rel="noopener"><strong>${t.review}</strong></a>${t.end}</p>`;
  }

  const uuid = location.pathname.match(/\/orders\/view\/([0-9a-f-]{30,})/i)?.[1] || '';
  const html = String.raw;
  const host = document.createElement('div');
  host.id = 'ddo-workspace-host';
  host.attachShadow({ mode: 'open' });
  host.shadowRoot.innerHTML = html`
    <style>
      .gmail-settings{position:absolute;z-index:4;right:62px;top:17px;display:grid;width:36px;height:36px;place-items:center;border:0;border-radius:50%;background:#f0e9ee;color:#512056;font-size:17px;cursor:pointer}.gmail-settings:hover{background:#e6dce3}.gmail-config{position:absolute;z-index:5;right:18px;top:59px;width:min(310px,calc(100% - 36px));padding:13px;border:1px solid #ded3db;border-radius:12px;background:white;box-shadow:0 15px 40px #220c2630}.gmail-config[hidden]{display:none}.gmail-config label{display:block;margin:0 0 4px;color:#6c6070;font-size:9px;font-weight:800;text-transform:uppercase}.gmail-config input{width:100%;margin-bottom:8px;border:1px solid #d8cdd5;border-radius:7px;background:#fff;color:#2d1b30;padding:7px 8px;font-size:10px}.gmail-config .signature-option{display:flex;align-items:center;gap:6px;margin:2px 0 10px;text-transform:none}.gmail-config .signature-option input{width:auto;margin:0;padding:0}.gmail-config .save-gmail{width:100%;border:0;border-radius:7px;background:#75d0c2;color:#173e38;padding:7px;font-size:10px;font-weight:850;cursor:pointer}.config-status{min-height:15px;margin:6px 0 0;color:#39766d;font-size:9px}
      .scenario-wrap{grid-column:1/-1}.scenario-wrap label{display:block;margin:0 0 6px;color:#665a69;font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.scenario-wrap select{width:100%;border:1px solid #d8cdd5;border-radius:9px;background:#fff;color:#3b263e;padding:10px 11px;font-size:12px}.order-number{display:inline-block;margin:3px 0;color:white;font-size:17px;font-weight:800;text-decoration:none}.order-number:hover{text-decoration:underline}
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700&display=swap');:host{all:initial}*{box-sizing:border-box}button,input{font:inherit}.backdrop{position:fixed;z-index:2147483646;inset:0;display:grid;place-items:center;padding:20px;background:#21102599;backdrop-filter:blur(4px);font:14px/1.48 Inter,"Segoe UI",system-ui,sans-serif;color:#2d1b30}.backdrop[hidden]{display:none}.modal{position:relative;width:min(900px,100%);max-height:min(820px,calc(100vh - 40px));display:grid;grid-template-columns:285px minmax(0,1fr);border:1px solid #ffffff30;border-radius:23px;background:#fffdfb;box-shadow:0 35px 100px #13061675;overflow:hidden}.side{padding:28px 24px;background:linear-gradient(155deg,#421446,#642568);color:white;overflow:auto}.eyebrow{margin:0 0 6px;color:#a8e5da;font-size:10px;font-weight:850;letter-spacing:.15em;text-transform:uppercase}.side h2{margin:0;font:700 25px/1.2 Orbitron,sans-serif;letter-spacing:.02em}.side-intro{margin:9px 0 23px;color:#ddcede;font-size:12px}.action-label{margin:0 0 9px;color:#ddcede;font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.actions{display:grid;gap:8px}.action{display:grid;grid-template-columns:36px 1fr;gap:10px;align-items:center;width:100%;border:1px solid #ffffff20;border-radius:13px;background:#ffffff0b;color:white;padding:10px;text-align:left;cursor:pointer;transition:.14s}.action:hover{background:#ffffff17}.action.active{border-color:#93dfd2;background:#ffffff20;box-shadow:inset 3px 0 #72d0c1}.action i{display:grid;width:36px;height:36px;place-items:center;border-radius:10px;background:#ffffff16;color:#9ce3d7;font-style:normal;font-size:18px;font-weight:850}.action strong,.action small{display:block}.action small{margin-top:2px;color:#cdbbce;font-size:10px;line-height:1.3}.order-card{margin-top:22px;padding:13px;border:1px solid #ffffff18;border-radius:13px;background:#ffffff0b}.order-card span,.order-card strong,.order-card small{display:block}.order-card span{color:#cdbbce;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.order-card strong{margin:3px 0;font-size:17px}.order-card small{margin-top:3px;color:#d8c9da;overflow:hidden;text-overflow:ellipsis}.main{position:relative;padding:60px 34px 30px;overflow:auto}.close{position:absolute;right:18px;top:17px;display:grid;width:36px;height:36px;place-items:center;border:0;border-radius:50%;background:#f0e9ee;color:#512056;font-size:23px;cursor:pointer}.language-switch{position:absolute;left:34px;top:19px;display:flex;gap:4px}.language-switch button{border:1px solid #d9cfd6;border-radius:8px;background:white;color:#695c6b;padding:5px 8px;font-size:10px;font-weight:850;cursor:pointer}.language-switch button.active{border-color:#55205a;background:#55205a;color:white}.loading{display:grid;min-height:360px;place-items:center;color:#807582;text-align:center}.loading[hidden],.editor[hidden]{display:none}.spinner{width:35px;height:35px;margin:0 auto 13px;border:3px solid #dfd5dc;border-top-color:#68cabb;border-radius:50%;animation:spin .75s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.error{max-width:410px;color:#af2945}.retry{margin-top:12px;border:0;border-radius:10px;background:#68cabb;color:#173c37;padding:9px 14px;font-weight:800;cursor:pointer}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dynamic-fields{display:contents}.field.full{grid-column:1/-1}.field label{display:block;margin:0 0 6px;color:#665a69;font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.field input{width:100%;border:1px solid #dcd2d9;border-radius:11px;background:white;color:#2d1b30;padding:11px 12px;outline:0}.field input:focus,.message:focus{border-color:#642568;box-shadow:0 0 0 3px #64256813}.message{min-height:280px;padding:16px;border:1px solid #dcd2d9;border-radius:11px;background:white;outline:0;line-height:1.55}.message p{margin:0 0 14px}.message a{color:#511c56;font-weight:700}.language-divider{margin:24px 0;border:0;border-top:2px solid #ded3db}.stars{color:#e8a000;letter-spacing:2px;font-size:17px}.copyrow{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.copy{border:1px solid #511c56;border-radius:10px;background:white;color:#511c56;padding:10px 14px;font-weight:800;cursor:pointer}.toast{position:absolute;right:22px;bottom:20px;border-radius:10px;background:#2d1b30;color:white;padding:10px 13px;box-shadow:0 8px 25px #0004}.toast[hidden]{display:none}@media(max-width:720px){.backdrop{padding:0}.modal{width:100%;height:100%;max-height:none;grid-template-columns:1fr;border-radius:0;overflow:auto}.side{padding:22px}.actions{grid-template-columns:repeat(2,1fr)}.action{display:block;text-align:center}.action i{margin:0 auto 5px}.action small{display:none}.order-card{display:none}.main{overflow:visible;padding:55px 20px 25px}.language-switch{left:20px}.grid{grid-template-columns:1fr}.field.full{grid-column:auto}}
    </style>
    <div class="backdrop" hidden>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="ddo-title">
        <aside class="side"><p class="eyebrow">Dutch Designers Outlet</p><h2>Workspace</h2><p class="action-label" style="margin-top:24px">Handeling</p><div class="actions"></div><div class="order-card"><span>Geopende order</span><a class="order-number" href="#" target="_blank" rel="noopener">Laden…</a><div class="order-customer"><small>Klantgegevens ophalen</small></div></div></aside>
        <main class="main"><div class="language-switch" aria-label="Taal"></div><button class="gmail-settings" type="button" title="Gmail instellen" aria-label="Gmail instellen">⚙</button><button class="close" type="button" aria-label="Sluiten">×</button><div class="gmail-config" hidden><label for="ddo-gmail-url">Apps Script /exec-URL</label><input id="ddo-gmail-url" class="gmail-url" type="url" spellcheck="false" placeholder="https://script.google.com/.../exec"><label for="ddo-gmail-secret">Toegangssleutel</label><input id="ddo-gmail-secret" class="gmail-secret" type="password" autocomplete="off" spellcheck="false"><label for="ddo-gmail-account">Gmail-accountslot (0, 1, 2, …)</label><input id="ddo-gmail-account" class="gmail-account" type="number" min="0" step="1" inputmode="numeric" value="1"><label class="signature-option"><input class="gmail-signature" type="checkbox" checked> Standaardhandtekening gebruiken</label><button class="save-gmail" type="button">Opslaan</button><p class="config-status"></p></div><div class="loading"><div><div class="spinner"></div><span>Ordergegevens ophalen…</span></div></div><section class="editor" hidden><div class="grid"><div class="scenario-wrap" hidden><label class="field-label" for="ddo-scenario">Scenario</label><select id="ddo-scenario" class="scenario"></select></div><div class="field full"><label for="ddo-subject">Onderwerp</label><input id="ddo-subject" class="subject"></div><div class="dynamic-fields"></div><div class="field full"><label>Bericht</label><div class="message" contenteditable="true" role="textbox" aria-multiline="true"></div></div></div><div class="copyrow"><button class="copy" id="createGmailDraft" type="button">Maak bericht</button></div></section></main>
      </section>
    </div>`;
  document.documentElement.append(host);

  const $ = selector => host.shadowRoot.querySelector(selector);
  const $$ = selector => [...host.shadowRoot.querySelectorAll(selector)];
  let selectedAction = 'uncollected';
  let selectedLang = 'en';
  let order = null;
  let loadingPromise = null;
  const actionValues = { uncollected: { paymentUrl: '' }, tracking: { tracking: '', trackingUrl: '' } };

  $('.actions').innerHTML = Object.entries(ACTIONS).map(([id, a]) => `<button class="action${id === selectedAction ? ' active' : ''}" data-action="${id}" type="button"><i>${a.icon}</i><span><strong>${a.label}</strong><small>${a.description}</small></span></button>`).join('');
  $$('.action').forEach(button => button.onclick = () => { selectedAction = button.dataset.action; $$('.action').forEach(item => item.classList.toggle('active', item === button)); if (order) render(); });
  $('.close').onclick = closeWorkspace;
  $('.backdrop').addEventListener('click', event => { if (event.target === $('.backdrop')) closeWorkspace(); });
  addEventListener('keydown', event => { if (event.key === 'Escape' && !$('.backdrop').hidden) closeWorkspace(); });

  function orderReference(o) { return o.orderId ? ` ${o.orderId}` : ''; }
  function orderSubject(start, o, end) { return [start, o.orderId, end].filter(Boolean).join(' '); }
  function linkHtml(url, label) { const safeLabel = escapeHtml(label || url || ''); try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? `<a href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener">${safeLabel}</a>` : safeLabel; } catch { return safeLabel; } }
  function parseDocument(source) { return new DOMParser().parseFromString(source, 'text/html'); }
  function fieldValue(doc, id) { return doc.querySelector(`#${CSS.escape(id)}`)?.value?.trim() || ''; }
  function detectOrderId() {
    const direct = ['[data-order-number]', '#external_id', 'input[name="external_id"]', '.order-number', '.external-id'].map(selector => document.querySelector(selector)).find(Boolean);
    const directValue = direct?.dataset?.orderNumber || direct?.value || direct?.textContent || '';
    const directMatch = directValue.match(/\b\d{4,}\b/);
    if (directMatch) return directMatch[0];
    const candidates = [...document.querySelectorAll('h1,h2,h3,.m-portlet__head-title,.breadcrumb,.m-subheader__title')].map(el => el.textContent.replace(/\s+/g, ' ').trim());
    for (const text of candidates) {
      const match = text.match(/(?:bestel(?:ling|nummer)?|order)\s*#?:?\s*(\d{4,})/i);
      if (match) return match[1];
    }
    const bodyMatch = document.body.innerText.match(/(?:Bestelnummer|Ordernummer)\s*:?\s*(\d{4,})/i);
    return bodyMatch?.[1] || '';
  }
  async function getHtml(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`GoedGepickt antwoordde met status ${response.status}.`);
    const text = await response.text();
    if (/name=["'](?:email|password)["']/i.test(text) && /login|inloggen/i.test(text)) throw new Error('Je sessie is verlopen. Log opnieuw in en probeer het nogmaals.');
    return text;
  }
  function waitForShipment(timeout = 5000) {
    return new Promise(resolve => {
      const started = Date.now();
      const inspect = () => {
        const links = [...document.querySelectorAll('#order_shipment_overview_datatable tbody td:first-child a[href]')];
        const link = links.find(item => /^https?:\/\//i.test(item.href));
        if (link) return resolve({ tracking: link.textContent.trim(), trackingUrl: link.href });
        const processing = document.querySelector('#order_shipment_overview_datatable_processing');
        const busy = processing && getComputedStyle(processing).display !== 'none';
        const info = document.querySelector('#order_shipment_overview_datatable_info')?.textContent || '';
        if ((!busy && /van 0 resultaten/i.test(info)) || Date.now() - started >= timeout) return resolve({ tracking: '', trackingUrl: '' });
        setTimeout(inspect, 160);
      };
      inspect();
    });
  }
  async function loadOrder() {
    if (!uuid) throw new Error('De interne ordercode kon niet uit de URL worden gelezen.');
    const doc = parseDocument(await getHtml(`/orders/edit/${encodeURIComponent(uuid)}`));
    const firstName = fieldValue(doc, 'billing_first_name');
    const lastName = fieldValue(doc, 'billing_last_name');
    const email = fieldValue(doc, 'billing_email');
    const countrySelect = doc.querySelector('#billing_country');
    const countryCode = countrySelect?.value || '';
    const country = countrySelect?.selectedOptions?.[0]?.textContent.trim() || countryCode;
    if (!firstName && !email) throw new Error('De klantgegevens konden niet uit de order worden gelezen.');
    const shipment = await waitForShipment();
    return { uuid, orderId: detectOrderId(), firstName: firstName || 'klant', lastName, email, country, countryCode, ...shipment };
  }
  function render() {
    const action = ACTIONS[selectedAction];
    $('.order-number').textContent = order.orderId ? `#${order.orderId}` : 'Huidige order';
    $('.order-number').href = order.orderId ? `https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=view&id=${encodeURIComponent(order.orderId)}` : '#';
    $('.order-customer').innerHTML = `${escapeHtml(`${order.firstName} ${order.lastName}`.trim())}<small>${escapeHtml(order.email || 'Geen e-mailadres')} · ${escapeHtml(order.countryCode || order.country || '—')}</small>`;
    actionValues.tracking.tracking = order.tracking || '';
    actionValues.tracking.trackingUrl = order.trackingUrl || '';
    const effectiveLang = action.language || selectedLang;
    $('.subject').value = action.subject(order, effectiveLang);
    $('.language-switch').hidden = Boolean(action.language);
    renderLanguageSwitch();
    const scenarios = action.scenarios || [];
    $('.scenario-wrap').hidden = !scenarios.length;
    $('.scenario').innerHTML = scenarios.map(scenario => `<option value="${scenario.id}">${escapeHtml(scenario.label)}</option>`).join('');
    $('.dynamic-fields').innerHTML = action.fields.map(field => `<div class="field"><label for="ddo-${field.id}">${field.label}</label><input id="ddo-${field.id}" data-action-field="${field.id}" value="${escapeHtml(actionValues[selectedAction][field.id] || '')}" placeholder="${field.placeholder}"></div>`).join('');
    $$('[data-action-field]').forEach(input => input.addEventListener('input', () => { actionValues[selectedAction][input.dataset.actionField] = input.value; renderMessage(); }));
    renderMessage();
    $('.loading').hidden = true;
    $('.editor').hidden = false;
  }
  function renderMessage() { const action = ACTIONS[selectedAction]; $('.message').innerHTML = action.html(order, actionValues[selectedAction], action.language || selectedLang); }
  function automaticLanguage(countryCode) { const code=(countryCode||'').toUpperCase(); if(code==='BE')return'nlfr'; if(['NL'].includes(code))return'nl'; if(['DE','AT','LI','CH'].includes(code))return'de'; if(['FR','MC','RE','GP','MQ','GF'].includes(code))return'fr'; return'en'; }
  function renderLanguageSwitch(){const choices=selectedLang==='nlfr'?['nlfr','nl','fr','en','de']:['nl','en','de','fr'];$('.language-switch').innerHTML=choices.map(code=>`<button type="button" data-lang="${code}" class="${code===selectedLang?'active':''}">${LANGUAGE_LABELS[code]}</button>`).join('');$$('[data-lang]').forEach(button=>button.onclick=()=>{selectedLang=button.dataset.lang;$('.subject').value=ACTIONS[selectedAction].subject(order,selectedLang);renderLanguageSwitch();renderMessage()})}
  async function openWorkspace() {
    $('.backdrop').hidden = false;
    document.documentElement.style.overflow = 'hidden';
    if (order) return render();
    $('.loading').hidden = false;
    $('.loading').innerHTML = '<div><div class="spinner"></div><span>Ordergegevens ophalen…</span></div>';
    loadingPromise ||= loadOrder();
    try { order = await loadingPromise; selectedLang = automaticLanguage(order.countryCode); render(); }
    catch (error) { loadingPromise = null; $('.loading').innerHTML = `<div class="error"><strong>Ophalen is mislukt</strong><br>${escapeHtml(error.message)}<br><button class="retry" type="button">Opnieuw proberen</button></div>`; $('.loading .retry').onclick = openWorkspace; }
  }
  function closeWorkspace() { $('.backdrop').hidden = true; document.documentElement.style.overflow = ''; }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  const GMAIL_URL_KEY = 'ddoWorkspaceGmailWebAppUrl';
  const GMAIL_SECRET_KEY = 'ddoWorkspaceGmailSecret';
  const GMAIL_ACCOUNT_KEY = 'ddoWorkspaceGmailAccount';
  const GMAIL_SIGNATURE_KEY = 'ddoWorkspaceGmailSignature';
  function validAppsScriptUrl(value) {
    try {
      const parsed = new URL(value.trim());
      const allowedHost = parsed.hostname === 'script.google.com' || parsed.hostname.endsWith('.script.google.com') || parsed.hostname === 'script.googleusercontent.com' || parsed.hostname.endsWith('.script.googleusercontent.com');
      return parsed.protocol === 'https:' && allowedHost && /\/exec\/?$/i.test(parsed.pathname);
    } catch { return false; }
  }
  function configureGmail() {
    const panel = $('.gmail-config');
    $('.gmail-url').value = GM_getValue(GMAIL_URL_KEY, '');
    $('.gmail-secret').value = GM_getValue(GMAIL_SECRET_KEY, '');
    $('.gmail-account').value = String(GM_getValue(GMAIL_ACCOUNT_KEY, 1));
    $('.gmail-signature').checked = GM_getValue(GMAIL_SIGNATURE_KEY, true);
    $('.config-status').textContent = '';
    panel.hidden = !panel.hidden;
    if (!panel.hidden) setTimeout(() => $('.gmail-url').focus(), 0);
  }
  $('.gmail-settings').onclick = configureGmail;
  $('.save-gmail').onclick = () => {
    const url = $('.gmail-url').value.trim();
    const secret = $('.gmail-secret').value.trim();
    const account = Number($('.gmail-account').value);
    const useSignature = $('.gmail-signature').checked;
    if (!validAppsScriptUrl(url)) { $('.config-status').textContent = 'Gebruik een geldige Google /exec-URL.'; return; }
    if (!secret) { $('.config-status').textContent = 'Vul de toegangssleutel in.'; return; }
    if (!Number.isInteger(account) || account < 0) { $('.config-status').textContent = 'Het accountslot moet 0 of hoger zijn.'; return; }
    GM_setValue(GMAIL_URL_KEY, url);
    GM_setValue(GMAIL_SECRET_KEY, secret);
    GM_setValue(GMAIL_ACCOUNT_KEY, account);
    GM_setValue(GMAIL_SIGNATURE_KEY, useSignature);
    $('.config-status').textContent = 'Instellingen opgeslagen.';
    setTimeout(() => { $('.gmail-config').hidden = true; }, 900);
  };
  function createDraftRequest(payload) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'POST', url: GM_getValue(GMAIL_URL_KEY, ''),
      headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(payload), timeout: 30000,
      onload: response => { try { const result = JSON.parse(response.responseText); result.ok ? resolve(result) : reject(new Error(result.error || 'Concept maken is mislukt.')); } catch { reject(new Error('Apps Script gaf geen geldig antwoord.')); } },
      onerror: () => reject(new Error('Apps Script kon niet worden bereikt.')),
      ontimeout: () => reject(new Error('Apps Script reageerde niet op tijd.'))
    }));
  }
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  }
  function downloadInvoice(orderId) {
    return new Promise((resolve, reject) => {
      const url = `https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=print&id=${encodeURIComponent(orderId)}`;
      GM_xmlhttpRequest({ method: 'GET', url, responseType: 'arraybuffer', timeout: 30000,
        onload: response => {
          const contentType = (response.responseHeaders.match(/^content-type:\s*([^;\r\n]+)/im)?.[1] || '').toLowerCase();
          if (response.status < 200 || response.status >= 300) return reject(new Error(`Factuur downloaden mislukte (status ${response.status}).`));
          if (!response.response?.byteLength) return reject(new Error('De gedownloade factuur is leeg.'));
          if (contentType.includes('text/html')) return reject(new Error('De factuur-URL gaf een HTML-pagina terug. Controleer of je bij DDO Admin bent ingelogd.'));
          resolve({ name: `Factuur-${orderId}.pdf`, mimeType: contentType || 'application/pdf', base64: arrayBufferToBase64(response.response) });
        },
        onerror: () => reject(new Error('De factuur kon niet worden gedownload.')),
        ontimeout: () => reject(new Error('Het downloaden van de factuur duurde te lang.'))
      });
    });
  }
  $('#createGmailDraft').onclick = async event => {
    if (!order?.email) return alert('Bij deze order is geen e-mailadres gevonden.');
    if (!GM_getValue(GMAIL_URL_KEY, '') || !GM_getValue(GMAIL_SECRET_KEY, '')) {
      $('.gmail-config').hidden = false;
      $('.gmail-url').value = GM_getValue(GMAIL_URL_KEY, '');
      $('.gmail-secret').value = GM_getValue(GMAIL_SECRET_KEY, '');
      $('.gmail-account').value = String(GM_getValue(GMAIL_ACCOUNT_KEY, 1));
      $('.gmail-signature').checked = GM_getValue(GMAIL_SIGNATURE_KEY, true);
      $('.config-status').textContent = 'Vul eerst beide instellingen in en sla ze op.';
      return;
    }
    const button = event.currentTarget;
    button.disabled = true; button.textContent = 'Bericht maken…';
    try {
      const action = ACTIONS[selectedAction];
      const attachments = action.attachment === 'invoice' ? [await downloadInvoice(order.orderId)] : [];
      const result = await createDraftRequest({ action: 'createDraft', secret: GM_getValue(GMAIL_SECRET_KEY, ''), to: action.recipient || order.email, subject: $('.subject').value, htmlBody: $('.message').innerHTML, plainBody: $('.message').innerText, useSignature: GM_getValue(GMAIL_SIGNATURE_KEY, true), attachments });
      button.textContent = 'Bericht gemaakt';
      const account = GM_getValue(GMAIL_ACCOUNT_KEY, 1);
      const draftPath = result.threadId ? `#drafts/${encodeURIComponent(result.threadId)}` : '#drafts';
      window.open(`https://mail.google.com/mail/u/${account}/${draftPath}`, '_blank', 'noopener');
    } catch (error) { alert(error.message); button.textContent = 'Maak bericht'; }
    finally { button.disabled = false; setTimeout(() => { button.textContent = 'Maak bericht'; }, 1800); }
  };

  function createMenuItem() {
    if (document.querySelector('#ddo-workspace-menu-item')) return true;
    const menu = document.querySelector('#m_ver_menu .m-menu__nav, .m-aside-menu .m-menu__nav, aside .m-menu__nav, .m-menu__nav');
    if (!menu) return false;
    const item = document.createElement('li');
    item.id = 'ddo-workspace-menu-item';
    item.className = 'm-menu__item m-menu__item--submenu';
    item.setAttribute('aria-haspopup', 'true');
    item.innerHTML = `<a href="#ddo-workspace" class="m-menu__link" title="DDO Workspace"><i class="m-menu__link-icon fa fa-th-large" aria-hidden="true"></i><span class="m-menu__link-title"><span class="m-menu__link-wrap"><span class="m-menu__link-text" style="font-family:Orbitron,'Segoe UI',sans-serif;letter-spacing:.04em">Workspace</span></span></span></a>`;
    item.querySelector('a').addEventListener('click', event => { event.preventDefault(); openWorkspace(); });
    menu.append(item);
    return true;
  }
  if (!createMenuItem()) {
    const observer = new MutationObserver(() => { if (createMenuItem()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
  }
})();
