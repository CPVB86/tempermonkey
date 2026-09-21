// ==UserScript==
// @name         GG Toolbox | Adapter | Workspace
// @namespace    https://dutchdesignersoutlet.com/
// @version      1.2.5
// @description  Klantberichten maken vanuit een geopende GoedGepickt-order.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      www.dutchdesignersoutlet.com
// @connect      lingerieoutlet.nl
// @run-at       document-idle
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-workspace.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-workspace.user.js
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  const page = unsafeWindow;
  if (window.top !== window.self || page.__ggWorkspace) return;
  const allowed = () => /^\/orders\/view\/[0-9a-f-]{30,}/i.test(location.pathname) && page.__ggToolbox?.isEnabled('workspace') === true;
  const requireAccess = () => { if (!allowed()) throw new Error('Geen toegang tot Workspace op deze pagina'); };
  let instance = null;
  async function run() {
    if (!allowed()) return;
    try { instance ||= initialize(); instance.host.hidden=false; await instance.open(); }
    catch(error) { if(allowed()) alert(error.message); }
  }
  page.__ggWorkspace = {version:'1.2.5',run,getState:()=>({ready:allowed(),reason:allowed()?'Open Workspace':'Open een order met Workspace-toegang'})};
  setInterval(()=>{if(instance && !allowed()){instance.close();instance.host.hidden=true;}},1000);
  function initialize() {
    requireAccess();

  // Landtarieven voor claims (exclusief btw): hier zelfstandig aan te passen.
  const CLAIM_COSTS = {
    NL: { shipping: '5.05', fuel: '0.84' },
    DE: { shipping: '6.80', fuel: '0.84' },
    BE: { shipping: '6.80', fuel: '0.84' },
    LU: { shipping: '9.32', fuel: '0.84' }
  };

  const ACTIONS = {
    uncollected: {
      label: 'Niet afgehaald', icon: '↩', description: 'Pakket is niet binnen de bewaartermijn afgehaald.',
      fields: [{ id: 'paymentUrl', label: 'Betaallink', placeholder: 'https://...', helpUrl: 'https://merchant.multisafepay.com/transactions/payment-links/new', copyMspData: true }],
      subject: (o, lang) => ({nl:`Bestelling ${o.orderId} niet afgehaald`,en:`Order ${o.orderId} not collected`,de:`Bestellung ${o.orderId} nicht abgeholt`,fr:`Commande ${o.orderId} non retirée`}[baseLang(lang)]),
      html: (o, v, lang) => localizedHtml(lang, code => uncollectedHtml(code, o, v))
    },
    tracking: {
      label: 'T&T buitenland', icon: '◎', description: 'Deel de internationale tracking met de klant.',
      fields: [],
      subject: (o, lang) => ({nl:`Je bestelling ${o.orderId} is onderweg`,en:`Your order ${o.orderId} is on its way`,de:`Ihre Bestellung ${o.orderId} ist unterwegs`,fr:`Votre commande ${o.orderId} est en route`}[baseLang(lang)]),
      html: (o, v, lang) => localizedHtml(lang, code => trackingHtml(code, o, v))
    },
    deliveryTime: {
      label: 'Levertijd', icon: '◷', description: 'Informeer over artikelen met een langere levertijd.',
      fields: [],
      subject: (o, lang) => ({nl:`Langere levertijd bestelling ${o.orderId}`,en:`Longer delivery time for order ${o.orderId}`,de:`Längere Lieferzeit für Bestellung ${o.orderId}`,fr:`Délai de livraison prolongé pour la commande ${o.orderId}`}[baseLang(lang)]),
      html: (o, v, lang) => localizedHtml(lang, code => deliveryTimeHtml(code, o))
    },
    dpdInvestigation: {
      label: 'DPD Onderzoek', icon: '⌕', description: 'Start een onderzoek naar een niet ontvangen pakket.',
      fields: [],
      scenarios: [
        { id:'deliveredMissingHome',label:'Bezorgd maar niet ontvangen - Thuis',language:'nl',recipient:'customerservice@dpd.nl',attachments:['invoice','nov'],subject:o=>`Pakket ${o.tracking||'$tracking'} (eigen ref: ${o.orderId||'$orderID'})`,html:o=>`<p>Beste,</p><p>Pakket ${escapeHtml(o.tracking||'$tracking')} (eigen ref: ${escapeHtml(o.orderId||'$orderID')}) is volgens de tracking bezorgd, echter niet bij consument. Het pakket bleek ook niet af te halen bij de buren. Graag verneem ik waar dit pakket feitelijk is.</p><p>Factuur en niet-ontvangen verklaring in bijlage. Zending betreft dames ondermode verzonden in een neutrale bruine vouwdoos.</p>` },
        { id:'directReturnCredit',label:'Direct retour - Creditkosten',language:'nl',recipient:'customerservice@dpd.nl',subject:o=>`Credit verzend- en retourkosten pakket ${o.tracking||'$tracking'} (eigen ref: ${o.orderId||'$orderID'})`,html:o=>`<p>Beste,</p><p>Graag een credit voor zowel verzend- als retourkosten van pakket ${escapeHtml(o.tracking||'$tracking')} (eigen ref: ${escapeHtml(o.orderId||'$orderID')}). Dit pakket is niet uitgeleverd, maar direct retour afzender gestuurd. Daar is vast een verklaring voor; die zou ik graag willen weten.</p>` },
        { id:'stuckAtDepot',label:'Blijft hangen in depot',language:'nl',recipient:'customerservice@dpd.nl',attachment:'invoice',subject:o=>`Vertraging pakket ${o.tracking||'$tracking'} (eigen ref: ${o.orderId||'$orderID'})`,html:o=>`<p>Beste,</p><p>Pakket ${escapeHtml(o.tracking||'$tracking')} (eigen ref: ${escapeHtml(o.orderId||'$orderID')}) blijft hangen in het depot. Ik verneem graag de reden van vertraging en zie het pakket spoedig uitgeleverd worden.</p><p>Factuur in bijlage. Zending betreft dames ondermode verzonden in een neutrale bruine vouwdoos.</p><p>Alvast bedankt.</p>` },
        { id:'nonReceiptStatement',label:'Niet ontvangen verklaring',languages:['nl','de','en'],attachment:'nov',subject:(o,l)=>({nl:`Niet-ontvangenverklaring bestelling ${o.orderId}`,de:`Erklärung über den Nichterhalt – Bestellung ${o.orderId}`,en:`Non-receipt statement for order ${o.orderId}`}[l]),html:(o,l)=>nonReceiptHtml(l,o) },
        { id:'claim',label:'Claim indienen',language:'nl',recipient:'customerservice@dpd.nl',attachment:'claim',fields:[{id:'salePrice',label:'Verkoopprijs excl. btw',placeholder:'Bijv. 89,95',required:true},{id:'margin',label:'Margefactor',placeholder:'Bijv. 2,5',required:true},{id:'shippingDate',label:'Verzenddatum pakket',type:'date',required:true},{id:'shippingCost',label:'Verzendkosten DPD excl. btw',required:true},{id:'fuelSurcharge',label:'Brandstoftoeslag excl. btw',required:true}],subject:o=>`Aansprakelijkheidstelling pakket ${o.tracking||'$tracking'} (eigen ref: ${o.orderId||'$orderID'})`,html:o=>`<p>Beste,</p><p>In de bijlage de door u opgevraagde documenten inzake pakket ${escapeHtml(o.tracking||'$tracking')} (eigen ref: ${escapeHtml(o.orderId||'$orderID')}).</p>` }
      ],
      subject: (o,lang) => currentScenario().subject(o,lang),
      html: (o,v,lang) => currentScenario().html(o,lang)
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
  function deliveryTimeHtml(lang, o) {
    const t = {nl:{dear:'Beste',intro:'Dit zijn de artikelen met een langere levertijd in jouw bestelling:'},en:{dear:'Dear',intro:'These are the items in your order with a longer delivery time:'},de:{dear:'Guten Tag',intro:'Dies sind die Artikel in Ihrer Bestellung mit einer längeren Lieferzeit:'},fr:{dear:'Bonjour',intro:'Voici les articles de votre commande dont le délai de livraison est plus long :'}}[lang];
    const items = o.externalItems?.length ? o.externalItems : ['$items'];
    return `<p>${t.dear} ${escapeHtml(o.firstName)},</p><p>${t.intro}</p><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }
  function nonReceiptHtml(lang,o){const t={nl:{dear:'Beste',p1:'Vervelend om te horen dat het pakket niet is ontvangen. Heeft u toevallig navraag gedaan of het pakket bij uw buren is geleverd? Vaak is hier toch sprake van.',p2:'Als dat geen succes oplevert, kan ik een onderzoek opstarten bij DPD. Behalve dat dit onderzoek al snel een week in beslag neemt, willen ze ook een volledig en juist ingevulde niet-ontvangenverklaring.',p3:'Ik heb het document als bijlage meegezonden. Zodra ik die van u retour heb, zet ik hem direct door naar DPD samen met de overige documentatie.',sorry:'Onze excuses voor het ongemak.'},de:{dear:'Guten Tag',p1:'Es tut uns leid zu hören, dass Sie das Paket nicht erhalten haben. Haben Sie eventuell bei Ihren Nachbarn nachgefragt, ob das Paket dort zugestellt wurde? Dies ist häufig dennoch der Fall.',p2:'Sollte dies nicht zum Erfolg führen, kann ich eine Nachforschung bei DPD einleiten. Diese Untersuchung dauert schnell eine Woche. DPD benötigt außerdem eine vollständig und korrekt ausgefüllte Erklärung über den Nichterhalt.',p3:'Ich habe das Dokument als Anlage beigefügt. Sobald ich es von Ihnen zurückerhalte, leite ich es zusammen mit den übrigen Unterlagen direkt an DPD weiter.',sorry:'Wir entschuldigen uns für die Unannehmlichkeiten.'},en:{dear:'Dear',p1:'We are sorry to hear that you have not received the parcel. Have you checked whether it may have been delivered to one of your neighbours? This is often the case.',p2:'If this does not resolve the matter, I can open an investigation with DPD. Besides the fact that this investigation can easily take a week, DPD also requires a fully and correctly completed non-receipt statement.',p3:'I have attached the document to this email. As soon as you return it to me, I will forward it directly to DPD together with the other documentation.',sorry:'Please accept our apologies for the inconvenience.'}}[lang];return `<p>${t.dear} ${escapeHtml(o.firstName)},</p><p>${t.p1}</p><p>${t.p2}</p><p>${t.p3}</p><p>${t.sorry}</p>`}

  const uuid = location.pathname.match(/\/orders\/view\/([0-9a-f-]{30,})/i)?.[1] || '';
  const html = String.raw;
  const host = document.createElement('div');
  host.id = 'gg-workspace-host';
  host.attachShadow({ mode: 'open' });
  host.shadowRoot.innerHTML = html`
    <style>
      .field label a,.field label .copy-msp-data{display:inline-flex;vertical-align:middle;margin-left:3px;border:0;background:transparent;color:#55205a;padding:0;cursor:pointer}.field label a:hover,.field label .copy-msp-data:hover{color:#75bfb4}
      .gmail-settings{position:absolute;z-index:4;right:62px;top:17px;display:grid;width:36px;height:36px;place-items:center;border:0;border-radius:50%;background:#f0e9ee;color:#512056;font-size:17px;cursor:pointer}.gmail-settings:hover{background:#e6dce3}.gmail-config{position:absolute;z-index:5;right:18px;top:59px;width:min(310px,calc(100% - 36px));padding:13px;border:1px solid #ded3db;border-radius:12px;background:white;box-shadow:0 15px 40px #220c2630}.gmail-config[hidden]{display:none}.gmail-config label{display:block;margin:0 0 4px;color:#6c6070;font-size:9px;font-weight:800;text-transform:uppercase}.gmail-config input{width:100%;margin-bottom:8px;border:1px solid #d8cdd5;border-radius:7px;background:#fff;color:#2d1b30;padding:7px 8px;font-size:10px}.gmail-config .signature-option{display:flex;align-items:center;gap:6px;margin:2px 0 10px;text-transform:none}.gmail-config .signature-option input{width:auto;margin:0;padding:0} .gmail-config .signature-option[hidden]{display:none}.google-login:disabled{cursor:default}.google-login:not(:disabled){cursor:pointer}.config-status{min-height:15px;margin:6px 0 0;color:#39766d;font-size:9px}
      .scenario-wrap{grid-column:1/-1}.scenario-wrap label{display:block;margin:0 0 6px;color:#665a69;font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.scenario-wrap select{width:100%;border:1px solid #d8cdd5;border-radius:9px;background:#fff;color:#3b263e;padding:10px 11px;font-size:12px}.order-link-row{display:flex;align-items:center;gap:5px}.order-number{display:inline-block;margin:3px 0;color:white;font-size:17px;font-weight:800;text-decoration:none}.order-number:hover{text-decoration:underline}.copy-order-data{display:inline-flex;align-items:center;border:0;background:transparent;color:#bce9e1;padding:0;cursor:pointer}.copy-order-data:hover{color:white}
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700&display=swap');:host{all:initial}*{box-sizing:border-box}button,input{font:inherit}.backdrop{position:fixed;z-index:2147483646;inset:0;display:grid;place-items:center;padding:20px;background:#21102599;backdrop-filter:blur(4px);font:14px/1.48 Inter,"Segoe UI",system-ui,sans-serif;color:#2d1b30}.backdrop[hidden]{display:none}.modal{position:relative;width:min(900px,100%);max-height:min(820px,calc(100vh - 40px));display:grid;grid-template-columns:285px minmax(0,1fr);border:1px solid #ffffff30;border-radius:23px;background:#fffdfb;box-shadow:0 35px 100px #13061675;overflow:hidden}.side{padding:28px 24px;background:linear-gradient(155deg,#421446,#642568);color:white;overflow:auto}.eyebrow{margin:0 0 6px;color:#a8e5da;font-size:10px;font-weight:850;letter-spacing:.15em;text-transform:uppercase}.side h2{margin:0;font:700 25px/1.2 Orbitron,sans-serif;letter-spacing:.02em}.side-intro{margin:9px 0 23px;color:#ddcede;font-size:12px}.action-label{margin:0 0 9px;color:#ddcede;font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.actions{display:grid;gap:8px}.action{display:grid;grid-template-columns:36px 1fr;gap:10px;align-items:center;width:100%;border:1px solid #ffffff20;border-radius:13px;background:#ffffff0b;color:white;padding:10px;text-align:left;cursor:pointer;transition:.14s}.action:hover{background:#ffffff17}.action.active{border-color:#93dfd2;background:#ffffff20;box-shadow:inset 3px 0 #72d0c1}.action i{display:grid;width:36px;height:36px;place-items:center;border-radius:10px;background:#ffffff16;color:#9ce3d7;font-style:normal;font-size:18px;font-weight:850}.action strong,.action small{display:block}.action small{margin-top:2px;color:#cdbbce;font-size:10px;line-height:1.3}.order-card{margin-top:22px;padding:13px;border:1px solid #ffffff18;border-radius:13px;background:#ffffff0b}.order-card span,.order-card strong,.order-card small{display:block}.order-card span{color:#cdbbce;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.order-card strong{margin:3px 0;font-size:17px}.order-card small{margin-top:3px;color:#d8c9da;overflow:hidden;text-overflow:ellipsis}.main{position:relative;padding:60px 34px 30px;overflow:auto}.close{position:absolute;right:18px;top:17px;display:grid;width:36px;height:36px;place-items:center;border:0;border-radius:50%;background:#f0e9ee;color:#512056;font-size:23px;cursor:pointer}.language-switch{position:absolute;left:34px;top:19px;display:flex;gap:4px}.language-switch button{border:1px solid #d9cfd6;border-radius:8px;background:white;color:#695c6b;padding:5px 8px;font-size:10px;font-weight:850;cursor:pointer}.language-switch button.active{border-color:#55205a;background:#55205a;color:white}.loading{display:grid;min-height:360px;place-items:center;color:#807582;text-align:center}.loading[hidden],.editor[hidden]{display:none}.spinner{width:35px;height:35px;margin:0 auto 13px;border:3px solid #dfd5dc;border-top-color:#68cabb;border-radius:50%;animation:spin .75s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.error{max-width:410px;color:#af2945}.retry{margin-top:12px;border:0;border-radius:10px;background:#68cabb;color:#173c37;padding:9px 14px;font-weight:800;cursor:pointer}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dynamic-fields{display:contents}.field.full{grid-column:1/-1}.field label{display:block;margin:0 0 6px;color:#665a69;font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.field input{width:100%;border:1px solid #dcd2d9;border-radius:11px;background:white;color:#2d1b30;padding:11px 12px;outline:0}.field input:focus,.message:focus{border-color:#642568;box-shadow:0 0 0 3px #64256813}.message{min-height:280px;padding:16px;border:1px solid #dcd2d9;border-radius:11px;background:white;outline:0;line-height:1.55}.message p{margin:0 0 14px}.message a{color:#511c56;font-weight:700}.language-divider{margin:24px 0;border:0;border-top:2px solid #ded3db}.stars{color:#e8a000;letter-spacing:2px;font-size:17px}.copyrow{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.copy{border:1px solid #511c56;border-radius:10px;background:white;color:#511c56;padding:10px 14px;font-weight:800;cursor:pointer}.toast{position:absolute;right:22px;bottom:20px;border-radius:10px;background:#2d1b30;color:white;padding:10px 13px;box-shadow:0 8px 25px #0004}.toast[hidden]{display:none}@media(max-width:720px){.backdrop{padding:0}.modal{width:100%;height:100%;max-height:none;grid-template-columns:1fr;border-radius:0;overflow:auto}.side{padding:22px}.actions{grid-template-columns:repeat(2,1fr)}.action{display:block;text-align:center}.action i{margin:0 auto 5px}.action small{display:none}.order-card{display:none}.main{overflow:visible;padding:55px 20px 25px}.language-switch{left:20px}.grid{grid-template-columns:1fr}.field.full{grid-column:auto}}
    .gmail-settings[hidden]{display:none}.main{padding-top:17px}.workspace-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-right:30px;min-height:36px;margin-bottom:18px}.workspace-toolbar .language-switch{position:static;flex-wrap:wrap}.workspace-toolbar .google-login{margin-left:auto;white-space:nowrap}.workspace-toolbar .language-switch[hidden]{display:none}</style>
    <div class="backdrop" hidden>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="ddo-title">
        <aside class="side"><p class="eyebrow">Dutch Designers Outlet</p><h2>Workspace</h2><p class="action-label" style="margin-top:24px">Handeling</p><div class="actions"></div><div class="order-card"><span>Geopende order</span><div class="order-link-row"><a class="order-number" href="#" target="_blank" rel="noopener">Laden…</a><button class="copy-order-data" type="button" title="Kopieer onderzoeksregel" aria-label="Kopieer onderzoeksregel"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div><div class="order-customer"><small>Klantgegevens ophalen</small></div></div></aside>
        <main class="main"><div class="workspace-toolbar"><div class="language-switch" aria-label="Taal"></div><button class="google-login" type="button" disabled style="display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border:1px solid #747775;border-radius:20px;background:#fff;color:#1f1f1f;text-decoration:none;font-family:Arial,sans-serif;font-size:12px;font-weight:400"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.7-.4-4H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.7c3.9-3.6 6-8.9 6-15.2z"/><path fill="#34A853" d="M24 44c5.4 0 9.9-1.8 13.2-4.8l-6.7-5.2c-1.8 1.2-4 1.9-6.5 1.9-5.2 0-9.6-3.5-11.2-8.2H5.9V33A20 20 0 0 0 24 44z"/><path fill="#FBBC05" d="M12.8 27.7a12 12 0 0 1 0-7.4V15H5.9a20 20 0 0 0 0 18z"/><path fill="#EA4335" d="M24 12.1c2.9 0 5.5 1 7.5 2.9l5.6-5.6A19 19 0 0 0 24 4 20 20 0 0 0 5.9 15l6.9 5.3c1.6-4.7 6-8.2 11.2-8.2z"/></svg><span class="google-login-label">Google controleren…</span></button></div><button class="gmail-settings" hidden type="button" title="Gmail instellen" aria-label="Gmail instellen">⚙</button><button class="close" type="button" aria-label="Sluiten">×</button><div class="gmail-config" hidden><p class="google-session-status" hidden role="status" aria-live="polite">Inlogstatus nog niet gecontroleerd.</p><p class="config-status"></p></div><div class="loading"><div><div class="spinner"></div><span>Ordergegevens ophalen…</span></div></div><section class="editor" hidden><div class="grid"><div class="scenario-wrap" hidden><label class="field-label" for="ddo-scenario">Scenario</label><select id="ddo-scenario" class="scenario"></select></div><div class="field full"><label for="ddo-subject">Onderwerp</label><input id="ddo-subject" class="subject"></div><div class="dynamic-fields"></div><div class="field full"><label>Bericht</label><div class="message" contenteditable="true" role="textbox" aria-multiline="true"></div></div></div><div class="copyrow"><button class="copy" id="copyMessage" type="button">Kopieer bericht</button><button class="copy" id="createGmailDraft" type="button">Maak bericht</button></div></section></main>
      </section>
    </div>`;
  document.documentElement.append(host);
  host.shadowRoot.addEventListener('click',event=>{if(!allowed()){event.preventDefault();event.stopImmediatePropagation();closeWorkspace();}},true);

  const $ = selector => host.shadowRoot.querySelector(selector);
  const $$ = selector => [...host.shadowRoot.querySelectorAll(selector)];
  let selectedAction = 'uncollected';
  let selectedLang = 'en';
  let order = null;
  let loadingPromise = null;
  let previousOverflow = null;
  const selectedScenarios = { dpdInvestigation: 'deliveredMissingHome' };
  const actionValues = { uncollected: { paymentUrl: '' }, tracking: { tracking: '', trackingUrl: '' } };
  let claimValues = null;
  function claimDefaults(o) {
    const costs = CLAIM_COSTS[String(o.countryCode || '').toUpperCase()] || {};
    return {salePrice:'',margin:'1,5',shippingDate:o.shipmentDate||'',shippingCost:costs.shipping||'',fuelSurcharge:costs.fuel||''};
  }
  function currentScenario(){const action=ACTIONS[selectedAction];return action.scenarios?.find(s=>s.id===selectedScenarios[selectedAction])||action.scenarios?.[0]}

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
    requireAccess();
    const response = await fetch(url, { credentials: 'same-origin' });
    requireAccess();
    if (!response.ok) throw new Error(`GoedGepickt antwoordde met status ${response.status}.`);
    const text = await response.text();
    if (/name=["'](?:email|password)["']/i.test(text) && /login|inloggen/i.test(text)) throw new Error('Je sessie is verlopen. Log opnieuw in en probeer het nogmaals.');
    return text;
  }
  function shipmentDateIso(text) {
    const match=String(text||'').trim().match(/^(\d{2})-(\d{2})-(\d{4})(?:\s|$)/);
    if(!match)return '';
    const iso=`${match[3]}-${match[2]}-${match[1]}`;
    const date=new Date(`${iso}T12:00:00Z`);
    return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:'';
  }
  function shipmentDateForLink(link) {
    const table=link.closest('table'),row=link.closest('tr');
    const headers=[...(table?.querySelectorAll('thead th')||[])];
    const index=headers.findIndex(header=>header.classList.contains('shipmentCreatedAt')||/aangemaakt op/i.test(header.textContent||''));
    return index<0?'':shipmentDateIso(row?.cells?.[index]?.textContent);
  }
  function waitForShipment(timeout = 5000) {
    return new Promise(resolve => {
      const started = Date.now();
      const inspect = () => {
        const links = [...document.querySelectorAll('#order_shipment_overview_datatable tbody td:first-child a[href]')];
        const link = links.find(item => /^https?:\/\//i.test(item.href));
        if (link) return resolve({ tracking: link.textContent.trim(), trackingUrl: link.href, shipmentDate:shipmentDateForLink(link) });
        const processing = document.querySelector('#order_shipment_overview_datatable_processing');
        const busy = processing && getComputedStyle(processing).display !== 'none';
        const info = document.querySelector('#order_shipment_overview_datatable_info')?.textContent || '';
        if ((!busy && /van 0 resultaten/i.test(info)) || Date.now() - started >= timeout) return resolve({ tracking: '', trackingUrl: '', shipmentDate:'' });
        setTimeout(inspect, 160);
      };
      inspect();
    });
  }
  function extractExternalItems() {
    const rows = [...document.querySelectorAll('#local_data tbody tr, .order_items_table tbody tr')];
    return rows.filter(row => [...row.querySelectorAll('.stockLocationName')].some(location => /(?:^|\s)00\.\s*Extern(?:\s|$)/i.test(location.textContent)))
      .map(row => row.querySelector('a[data-product-uuid][data-stock-information="order"]')?.textContent.replace(/\s+/g, ' ').trim().replace(/\s*-\s*\[(?:ext|bar)\]\s*$/i, '').trim())
      .filter(Boolean);
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
    return { uuid, orderId: detectOrderId(), firstName: firstName || 'klant', lastName, email, country, countryCode, externalItems: extractExternalItems(), ...shipment };
  }
  function render() {
    requireAccess();
    const action = ACTIONS[selectedAction];
    const scenario = currentScenario();
    $('.order-number').textContent = order.orderId ? `#${order.orderId}` : 'Huidige order';
    $('.order-number').href = order.orderId ? `https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=view&id=${encodeURIComponent(order.orderId)}` : '#';
    $('.order-customer').innerHTML = `${escapeHtml(`${order.firstName} ${order.lastName}`.trim())}<small>${escapeHtml(order.email || 'Geen e-mailadres')} · ${escapeHtml(order.countryCode || order.country || '—')}</small>`;
    actionValues.tracking.tracking = order.tracking || '';
    actionValues.tracking.trackingUrl = order.trackingUrl || '';
    if (scenario?.languages && !scenario.languages.includes(selectedLang)) { const automatic = automaticLanguage(order.countryCode); selectedLang = scenario.languages.includes(automatic) ? automatic : 'en'; }
    const effectiveLang = scenario?.language || action.language || selectedLang;
    $('.subject').value = action.subject(order, effectiveLang);
    $('.language-switch').hidden = Boolean(scenario?.language || action.language);
    renderLanguageSwitch();
    const scenarios = action.scenarios || [];
    $('.scenario-wrap').hidden = !scenarios.length;
    $('.scenario').innerHTML = scenarios.map(item => `<option value="${item.id}"${item.id===scenario?.id?' selected':''}>${escapeHtml(item.label)}</option>`).join('');
    $('.scenario').onchange = event => { selectedScenarios[selectedAction] = event.target.value; render(); };
    const fields = scenario?.fields || action.fields;
    const values = scenario?.id==='claim' ? (claimValues ||= claimDefaults(order)) : actionValues[selectedAction];
    $('.dynamic-fields').innerHTML = fields.map(field => `<div class="field"><label for="ddo-${field.id}">${field.label}${field.required?' *':''}${field.helpUrl ? ` <a href="${escapeHtml(field.helpUrl)}" target="_blank" rel="noopener" title="Open ${escapeHtml(field.label)}" aria-label="Open ${escapeHtml(field.label)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"></path></svg></a>` : ''}${field.copyMspData?` <button class="copy-msp-data" type="button" title="Kopieer klantgegevens voor MultiSafepay" aria-label="Kopieer MSP-data"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path></svg></button>`:''}</label><input id="ddo-${field.id}" data-action-field="${field.id}" type="${field.type||'text'}" ${field.required?'required':''} value="${escapeHtml(values?.[field.id] || '')}" placeholder="${escapeHtml(field.placeholder||'')}"></div>`).join('');
    $$('[data-action-field]').forEach(input => input.addEventListener('input', () => { values[input.dataset.actionField] = input.value; renderMessage(); }));
    const mspButton = $('.copy-msp-data');
    if (mspButton) mspButton.onclick = async () => {
      const clipboardText = [order.firstName, order.lastName, order.email, `${order.orderId}a`, `Opnieuw verzenden ${order.orderId}`, order.countryCode].join('\t');
      await navigator.clipboard.writeText(clipboardText);
      const original = mspButton.innerHTML;
      mspButton.textContent = '✓';
      setTimeout(() => { mspButton.innerHTML = original; }, 1400);
    };
    renderMessage();
    $('.loading').hidden = true;
    $('.editor').hidden = false;
  }
  function renderMessage() { const action = ACTIONS[selectedAction]; const scenario=currentScenario(); $('.message').innerHTML = action.html(order, actionValues[selectedAction], scenario?.language || action.language || selectedLang); }
  function automaticLanguage(countryCode) { const code=(countryCode||'').toUpperCase(); if(code==='BE')return'nlfr'; if(['NL'].includes(code))return'nl'; if(['DE','AT','LI','CH'].includes(code))return'de'; if(['FR','MC','RE','GP','MQ','GF'].includes(code))return'fr'; return'en'; }
  function renderLanguageSwitch(){const scenario=currentScenario();const choices=scenario?.languages|| (order?.countryCode?.toUpperCase()==='BE'?['nlfr','nl','fr','en','de']:['nl','en','de','fr']);$('.language-switch').innerHTML=choices.map(code=>`<button type="button" data-lang="${code}" class="${code===selectedLang?'active':''}">${LANGUAGE_LABELS[code]}</button>`).join('');$$('[data-lang]').forEach(button=>button.onclick=()=>{selectedLang=button.dataset.lang;$('.subject').value=ACTIONS[selectedAction].subject(order,selectedLang);renderLanguageSwitch();renderMessage()})}
  async function openWorkspace() {
    void checkGoogleStatus();
    requireAccess();
    $('.backdrop').hidden = false;
    if(previousOverflow===null)previousOverflow=document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    if (order) return render();
    $('.loading').hidden = false;
    $('.loading').innerHTML = '<div><div class="spinner"></div><span>Ordergegevens ophalen…</span></div>';
    loadingPromise ||= loadOrder();
    try { const loadedOrder = await loadingPromise; requireAccess(); order=loadedOrder; selectedLang = automaticLanguage(order.countryCode); render(); }
    catch (error) { loadingPromise = null; $('.loading').innerHTML = `<div class="error"><strong>Ophalen is mislukt</strong><br>${escapeHtml(error.message)}<br><button class="retry" type="button">Opnieuw proberen</button></div>`; $('.loading .retry').onclick = openWorkspace; }
  }
  function closeWorkspace() { $('.backdrop').hidden = true; if(previousOverflow!==null){document.documentElement.style.overflow=previousOverflow;previousOverflow=null;} }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  $('.copy-order-data').onclick = async event => {
    if (!order) return;
    const today = new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    const line = [order.orderId || '', `${order.firstName} ${order.lastName}`.trim(), order.tracking || '', today, '', 'Opgestart'].join('\t');
    await navigator.clipboard.writeText(line);
    const button = event.currentTarget;
    const original = button.innerHTML;
    button.textContent = '✓';
    setTimeout(() => { button.innerHTML = original; }, 1300);
  };
  const GMAIL_WEB_APP_URL = 'https://script.google.com/a/macros/dutchdesignersoutlet.com/s/AKfycbwii3uoOCZo_AnkkldYzbIybHbCYePh9FcLeLGeYk95XGJ2iPXyOfHsGkgBoHf1QY-J/exec';
  const GMAIL_PROTOCOL = 'gg-workspace-google-v1';
  const GOOGLE_EMAIL_KEY = 'ggWorkspaceGoogleEmail';
  const GMAIL_SIGNATURE_KEY = 'ddoWorkspaceGmailSignature';
  function validAppsScriptUrl(value) {
    try {
      const parsed = new URL(value.trim());
      const allowedHost = parsed.hostname === 'script.google.com' || parsed.hostname.endsWith('.script.google.com') || parsed.hostname === 'script.googleusercontent.com' || parsed.hostname.endsWith('.script.googleusercontent.com');
      return parsed.protocol === 'https:' && allowedHost && /\/exec\/?$/i.test(parsed.pathname);
    } catch { return false; }
  }
  let checkingGoogleStatus = false, loginPending = false;
  const LOGIN_STATUS_KEY = 'ggWorkspaceLoginStatus';
  async function checkGoogleStatus(force = false) {
    if (checkingGoogleStatus || !allowed()) return;
    checkingGoogleStatus = true;
    const status = $('.google-session-status');
    status.textContent = 'Google-login controleren…';
    status.style.color = '#5f6368';
    status.title = '';
    const login = $('.google-login');
    const label = $('.google-login-label');
    login.disabled = true;
    login.style.background = '#fff';
    login.style.color = '#1f1f1f';
    label.textContent = 'Google controleren…';
    try {
      const cached = GM_getValue(LOGIN_STATUS_KEY, null);
      const session = !force && cached?.email && Date.now() - cached.at < 15*60*1000 ? cached : await workspaceSession();
      GM_setValue(LOGIN_STATUS_KEY, {email:session.email,at:session.at || Date.now()});
      status.textContent = 'Ingelogd als ' + session.email;
      status.style.color = '#188038';
      label.textContent = '✓ Ingelogd met Google';
      login.style.background = '#e6f4ea';
      login.style.color = '#137333';
      } catch (error) {
      GM_setValue(LOGIN_STATUS_KEY, null);
      status.textContent = 'Niet ingelogd of toegang niet bevestigd.';
      status.style.color = '#b3261e';
      status.title = error.message;
      label.textContent = 'Inloggen met Google';
      login.disabled = false;
    } finally { checkingGoogleStatus = false; }
  }
  window.addEventListener('focus', () => {
    if (loginPending) { loginPending = false; checkGoogleStatus(true); }
  });
  function configureGmail() {
    const panel = $('.gmail-config');
    $('.config-status').textContent = '';
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { $('.google-login').focus(); checkGoogleStatus(); }
  }
  $('.gmail-settings').onclick = configureGmail;
  $('.google-login').onclick = () => {
    requireAccess();
    if (!$('.google-login').disabled) {loginPending = true; GM_openInTab(googleBridgeUrl().href, {active: true, insert: true, setParent: true});}
  };
  function googleBridgeUrl(email = GM_getValue(GOOGLE_EMAIL_KEY, '')) {
    const url = new URL(GMAIL_WEB_APP_URL);
    if (email) url.searchParams.set('authuser', email);
    return url;
  }
  function gmailDraftUrl(result) {
    if (!/^[^\s@]+@dutchdesignersoutlet\.com$/i.test(result.mailboxEmail || '')) throw new Error('De backend heeft geen geldige conceptmailbox teruggegeven.');
    const url = new URL('https://mail.google.com/mail/');
    url.searchParams.set('authuser', result.mailboxEmail);
    url.hash = result.threadId ? 'drafts/' + encodeURIComponent(result.threadId) : 'drafts';
    return url.href;
  }
  function bridgeRequest(method, payload, email) {
    requireAccess();
    const url = googleBridgeUrl(email);
    if (method === 'GET') {
      url.searchParams.set('action', 'session');
      url.searchParams.set('_', String(Date.now()));
    }
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method, url: url.href, anonymous: false,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      ...(method === 'POST' ? {data: JSON.stringify(payload)} : {}), timeout: 60000,
      onload: response => {
        let result;
        try { result = JSON.parse(response.responseText); }
        catch { reject(new Error('Google-login nodig, of de backend is nog niet bijgewerkt. Gebruik de Google-knop bovenaan en probeer daarna opnieuw.')); return; }
        if (response.status < 200 || response.status >= 300 || !result?.ok) {
          reject(new Error(result?.error || 'Google-toegang geweigerd. Log in met je bedrijfsaccount.')); return;
        }
        resolve(result);
      },
      onerror: () => reject(new Error('Google kon niet worden bereikt.')),
      ontimeout: () => reject(new Error('Google reageerde niet op tijd.'))
    }));
  }
  async function workspaceSession() {
    const expected = GM_getValue(GOOGLE_EMAIL_KEY, '');
    const session = await bridgeRequest('GET');
    if (session.protocol !== GMAIL_PROTOCOL || !/^[^\s@]+@dutchdesignersoutlet\.com$/i.test(session.email || '') || !session.csrf) {
      throw new Error('Werk eerst de Gmail-backend bij naar de versie met Google-login.');
    }
    if (expected && expected.toLowerCase() !== session.email.toLowerCase()) throw new Error('Google gebruikte een ander account. Selecteer je bedrijfsaccount via Inloggen bij Google.');
    GM_setValue(GOOGLE_EMAIL_KEY, session.email.toLowerCase());
    return session;
  }
  async function createDraftRequest(payload, session) {
    requireAccess();
    try {
      return await bridgeRequest('POST', {...payload, csrf: session.csrf, requestId: crypto.randomUUID()}, session.email);
    } catch (error) {
      // Never repeat a POST automatically: its response may have been lost after creating the draft.
      throw new Error(error.message + ' Controleer eerst je Gmail-concepten voordat je opnieuw op Maak bericht klikt.');
    }
  }
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  }
  function downloadInvoice(orderId) {
    requireAccess();
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
  function downloadNovStatement(lang) {
    requireAccess();
    const code = ['nl','de','en'].includes(lang) ? lang : 'en';
    const url = `https://lingerieoutlet.nl/nov-${code}.pdf`;
    return new Promise((resolve, reject) => GM_xmlhttpRequest({ method:'GET',url,responseType:'arraybuffer',timeout:30000,
      onload:response=>{const contentType=(response.responseHeaders.match(/^content-type:\s*([^;\r\n]+)/im)?.[1]||'').toLowerCase();if(response.status<200||response.status>=300)return reject(new Error(`Niet-ontvangenverklaring downloaden mislukte (status ${response.status}).`));if(!response.response?.byteLength)return reject(new Error('De niet-ontvangenverklaring is leeg.'));if(contentType.includes('text/html'))return reject(new Error('De bijlage-URL gaf geen PDF terug.'));resolve({name:`niet-ontvangenverklaring-${code}.pdf`,mimeType:'application/pdf',base64:arrayBufferToBase64(response.response)})},
      onerror:()=>reject(new Error('De niet-ontvangenverklaring kon niet worden gedownload.')),ontimeout:()=>reject(new Error('Het downloaden van de niet-ontvangenverklaring duurde te lang.'))
    }));
  }
  function claimCents(value, label, positive = false) {
    const text = String(value ?? '').trim().replace(/\s/g,'');
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) throw new Error(`${label}: vul een geldig bedrag zonder valutateken in.`);
    const cents = Math.round(Number(text.replace(',','.')) * 100);
    if (!Number.isSafeInteger(cents) || (positive ? cents <= 0 : cents < 0)) throw new Error(`${label}: bedrag buiten bereik.`);
    return cents;
  }
  function claimData(o, values, senderEmail, today = new Date()) {
    if (!o?.tracking || !o?.orderId) throw new Error('Voor de claim zijn een tracking-ID en eigen orderreferentie verplicht.');
    const sender = String(senderEmail||'').toLowerCase();
    const signer = sender==='folkert@dutchdesignersoutlet.com'?'Folkert van Beek':sender==='chantor@dutchdesignersoutlet.com'?'Chantor Pascal van Beek':'';
    if (!signer) throw new Error('Claim indienen kan alleen vanuit folkert@ of chantor@dutchdesignersoutlet.com.');
    const marginText=String(values?.margin||'').trim().replace(',','.');
    if (!/^\d+(?:\.\d+)?$/.test(marginText) || Number(marginText)<=0 || Number(marginText)>100) throw new Error('Vul een geldige margefactor groter dan 0 en maximaal 100 in.');
    const margin=Number(marginText),sale=claimCents(values.salePrice,'Verkoopprijs',true),shipping=claimCents(values.shippingCost,'Verzendkosten'),fuel=claimCents(values.fuelSurcharge,'Brandstoftoeslag');
    const rawDate=String(values.shippingDate||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(rawDate))throw new Error('Vul de verzenddatum van het pakket in.');
    const sent=new Date(`${rawDate}T12:00:00Z`);
    if(Number.isNaN(sent.getTime()) || sent.toISOString().slice(0,10)!==rawDate)throw new Error('De verzenddatum is ongeldig.');
    const purchase=Math.round(sale/margin),total=purchase+shipping+fuel;
    const dateFormat=new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Amsterdam'});
    return {tracking:o.tracking,reference:o.orderId,sender,signer,cc:sender.startsWith('folkert@')?'chantor@dutchdesignersoutlet.com':'folkert@dutchdesignersoutlet.com',sale,margin:marginText.replace('.',','),purchase,shipping,fuel,total,shipDate:dateFormat.format(sent),today:dateFormat.format(today)};
  }
  function claimEuro(cents){return '€ '+(cents/100).toFixed(2).replace('.',',')}
  function claimPdfBytes(data) {
    // Eén A4-pagina met ingebouwde PDF-standaardlettertypen: geen externe bibliotheek nodig.
    const commands=[];
    const rgb=hex=>[1,3,5].map(i=>(parseInt(hex.slice(i,i+2),16)/255).toFixed(3)).join(' ');
    const fill=(hex)=>commands.push(`${rgb(hex)} rg`);
    const stroke=(hex)=>commands.push(`${rgb(hex)} RG`);
    const rect=(x,y,w,h,hex)=>{fill(hex);commands.push(`${x} ${y} ${w} ${h} re f`)};
    const line=(x1,y1,x2,y2,hex,width=1)=>{stroke(hex);commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`)};
    const escaped=value=>[...String(value)].map(char=>{const code=char.charCodeAt(0);if(char==='\\'||char==='('||char===')')return'\\'+char;if(code===0x20AC)return'\\200';if(code>=32&&code<=126)return char;if(code>=160&&code<=255)return'\\'+code.toString(8).padStart(3,'0');return'-'}).join('');
    const text=(value,x,y,size=10,bold=false,color='#25313b')=>{fill(color);commands.push(`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escaped(value)}) Tj ET`)};
    const pill=(label,x,y,w)=>{const h=23,r=11.5,k=0.5523*r;fill('#f2eaf3');commands.push(`${x+r} ${y} m ${x+w-r} ${y} l ${x+w-r+k} ${y} ${x+w} ${y+r-k} ${x+w} ${y+r} c ${x+w} ${y+r+k} ${x+w-r+k} ${y+h} ${x+w-r} ${y+h} c ${x+r} ${y+h} l ${x+r-k} ${y+h} ${x} ${y+r+k} ${x} ${y+r} c ${x} ${y+r-k} ${x+r-k} ${y} ${x+r} ${y} c f`);text(label,x+10,y+8,8,true,'#54235b')};
    rect(0,0,595,842,'#ffffff');rect(0,826,595,16,'#54235b');
    text('F&M',54,775,21,true,'#54235b');text('DUTCH DESIGNERS OUTLET',54,755,9,true,'#57716c');
    text('Lindenhoutseweg 57a',384,781,10,false);text('6545 AH Nijmegen',384,764,10,false);
    line(54,733,541,733,'#d6c9d7',1.5);
    text(`Nijmegen, ${data.today}`,54,700,10,false);
    text(`AANSPRAKELIJKHEIDSTELLING PAKKET ${data.tracking} (EIGEN REF: ${data.reference})`,54,660,9,true,'#54235b');
    text('DPD Nederland B.V.',54,630,10,false);
    text('Headoffice Oirschot',54,615,10,false);
    text('P.O. box 302',54,600,10,false);
    text('5680 AH Best',54,585,10,false);
    text('Geachte heer, mevrouw,',54,552,10,false);
    text(`Hierbij stellen wij DPD Nederland B.V., gevestigd te Oirschot, aansprakelijk voor het verlies van pakket ${data.tracking}.`,54,526,9,false);
    const rows=[
      ['Verzenddatum pakket',data.shipDate],
      ['Factuurbedrag exclusief btw',claimEuro(data.sale)],
      ['Inkoopwaarde* exclusief btw',claimEuro(data.purchase)],
      ['Verzendkosten DPD exclusief btw',claimEuro(data.shipping)],
      ['Brandstoftoeslag',claimEuro(data.fuel)],
      ['Totaal schadebedrag',claimEuro(data.total)]
    ];
    const top=479,height=34;rows.forEach(([label,value],index)=>{const y=top-(index+1)*height;if(index===5)rect(54,y,487,height,'#f2eaf3');else if(index%2===0)rect(54,y,487,height,'#f7f8f8');text(label,67,y+12,10,index===5);text(value,407,y+12,10,index===5,'#54235b')});
    line(54,top-6*height,541,top-6*height,'#d6c9d7');
    text(`*Marge is ${data.margin} op deze collectie.`,54,251,9,false,'#67746f');
    text('Ervan uitgaande u hiermee voldoende te hebben geïnformeerd.',54,224,10,false);
    text('Met vriendelijke groet,',54,197,10,false);text(data.signer,54,166,11,true,'#54235b');
    line(54,100,541,100,'#d6c9d7');
    pill('BTW NL161820529B01',54,69,125);pill('KVK 09086520',186,69,90);pill('IBAN NL19INGB0009146002',283,69,165);pill('BIC INGBNL2A',455,69,85);
    pill('office@dutchdesignersoutlet.com',54,38,202);pill('+316243773103',264,38,95);pill('https://www.dutchdesignersoutlet.com',367,38,174);
    const stream=commands.join('\n')+'\n';
    const objects=[
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
    ];
    let output='%PDF-1.4\n',offsets=[0];objects.forEach((body,index)=>{offsets.push(output.length);output+=`${index+1} 0 obj\n${body}\nendobj\n`});const start=output.length;
    output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
    for(const offset of offsets.slice(1))output+=`${String(offset).padStart(10,'0')} 00000 n \n`;
    output+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return Uint8Array.from(output,char=>char.charCodeAt(0));
  }
  function claimAttachment(data){const bytes=claimPdfBytes(data),safeId=String(data.tracking).replace(/[^a-z0-9-]/gi,'_');return{name:`aansprakelijkheidstelling-${safeId}.pdf`,mimeType:'application/pdf',base64:arrayBufferToBase64(bytes.buffer)}}
  $('#copyMessage').onclick = async event => {
    const button = event.currentTarget;
    const message = $('.message');
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([message.innerHTML], { type: 'text/html' }),
        'text/plain': new Blob([message.innerText], { type: 'text/plain' })
      })]);
    } catch { await navigator.clipboard.writeText(message.innerText); }
    button.textContent = 'Gekopieerd';
    setTimeout(() => { button.textContent = 'Kopieer bericht'; }, 1400);
  };
  $('#createGmailDraft').onclick = async event => {
    requireAccess();
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true; button.textContent = 'Google controleren…';
    try {
      const session = await workspaceSession();
      requireAccess();
      button.textContent = 'Bericht maken…';
      const action = ACTIONS[selectedAction];
      const scenario = currentScenario();
      const effectiveLang = scenario?.language || selectedLang;
      const recipient = scenario?.recipient || action.recipient || order?.email;
      if (!recipient) throw new Error('Bij deze order is geen ontvanger gevonden.');
      const types = scenario?.attachments || (scenario?.attachment || action.attachment ? [scenario?.attachment || action.attachment] : []);
      const claim = types.includes('claim') ? claimData(order,claimValues,session.email) : null;
      const attachments = [];
      for (const type of types) {
        if(type==='invoice') attachments.push(await downloadInvoice(order.orderId));
        else if(type==='nov') attachments.push(await downloadNovStatement(effectiveLang));
        else if(type==='claim') attachments.push(claimAttachment(claim));
      }
      const result = await createDraftRequest({ action: 'createDraft', to: recipient, cc: claim?.cc || '', subject: $('.subject').value, htmlBody: $('.message').innerHTML, plainBody: $('.message').innerText, useSignature: true, attachments }, session);
      button.textContent = 'Bericht gemaakt';
      GM_openInTab(gmailDraftUrl(result), { active: true, insert: true, setParent: true });
    } catch (error) {
      // Settings stay hidden; operation errors remain visible in the editor.
      window.alert(error.message);
      GM_setValue(LOGIN_STATUS_KEY, null);
      checkGoogleStatus(true);
      $('.config-status').textContent = error.message;
      button.textContent = 'Maak bericht';
    }
    finally { button.disabled = false; setTimeout(() => { button.textContent = 'Maak bericht'; }, 1800); }
  };

  return {host,open:openWorkspace,close:()=>{closeWorkspace();order=null;loadingPromise=null;}};
  }
})();
