// ==UserScript==
// @name         DDO | Van de Velde producttekst
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      1.3.0
// @description  Vult de producttekst vanuit de Van de Velde B2B-API voor PrimaDonna en Marie Jo.
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/van-de-velde-card-tekst.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/van-de-velde-card-tekst.user.js
// @match        https://www.dutchdesignersoutlet.com/*
// @match        https://dutchdesignersoutlet.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      b2b-api.vandeveldeservice.com
// ==/UserScript==

(function () {
    'use strict';

    const API = 'https://b2b-api.vandeveldeservice.com/gateway/products/';
    const BUTTON_ID = 'ddo-vdv-producttekst';

    // De API-teksten zijn Engelstalig. Bekende Van de Velde-zinnen worden hier
    // consequent vertaald; onbekende teksten blijven intact zodat niets verdwijnt.
    const phrases = new Map([
        ['A sensual, refined semi-sheer embroidered look with an impeccable fit.', 'Sensuele en verfijnde, semi-transparante broderielook met een uitstekende fit.'],
        ['Sensual, sophisticated styles with an impeccable fit, crafted from delicate semi-sheer embroidered fabric.', 'Sensuele en verfijnde modellen met een uitstekende fit, uitgevoerd in delicate semi-transparante broderie.'],
        ['Pure class in black.', 'Pure klasse in zwart.'],
        ['Brazilian briefs with an elegant cut and a comfortable fit.', 'Braziliaanse slip met een elegante snit en comfortabele pasvorm.'],
        ['The higher cut of these Rio briefs creates an elegant silhouette.', 'De hogere beenuitsnijding van deze rioslip creëert een elegant silhouet.'],
        ['High-waist briefs for a cool retro silhouette.', 'Tailleslip voor een modieus retrosilhouet.'],
        ['Light, comfy and lacey with a cool retro look.', 'Licht, comfortabel en kanten met een modieuze retrol look.'],
        ['A flattering and soft neutral.', 'Een flatterende, zachte neutrale kleur.'],
        ['Non-padded underwired bra', 'Niet-voorgevormde beugel-bh'],
        ['Non transparent', 'Niet-transparante look'],
        ['Transparent', 'Transparante look']
    ]);

    const care = new Map([
        ['Do not bleach', 'Niet bleken'],
        ['No professionally Dry Clean', 'Geen professionele reiniging'],
        ['Do not dry clean', 'Geen professionele reiniging'],
        ['Do not tumble dry', 'Niet trommeldrogen'],
        ['30 °C Mild process', '30°C beperkt programma'],
        ['30 °C Normal process', '30°C normaal programma'],
        ['Do not iron', 'Niet strijken']
    ]);

    const materials = new Map([
        ['Cotton', 'Katoen'],
        ['Elastane', 'Elastaan'],
        ['Polyester', 'Polyester'],
        ['Polyamide', 'Polyamide'],
        ['Viscose', 'Viscose'],
        ['Modal', 'Modal'],
        ['Silk', 'Zijde'],
        ['Wool', 'Wol']
    ]);

    function clean(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function translate(value) {
        const text = clean(value);
        return phrases.get(text) || text;
    }

    function selectedBrand() {
        const select = document.querySelector('select#brand[name="brand_id"]');
        return clean(select?.selectedOptions?.[0]?.textContent);
    }

    function allowedBrand() {
        return /^(?:primadonna|marie\s*jo|mariejo)\b/i.test(selectedBrand());
    }

    function supplierPid() {
        return clean(document.querySelector('input[name="supplier_pid"]')?.value);
    }

    function list(items) {
        const unique = [...new Set(items.map(translate).filter(Boolean))];
        return unique.length ? `<ul>${unique.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
    }

    function escapeHtml(value) {
        const node = document.createElement('div');
        node.textContent = String(value || '');
        return node.innerHTML;
    }

    function careLabel(item) {
        const text = clean(item?.label || item?.key || item).replace('Â°C', '°C');
        return care.get(text) || text;
    }

    function compositionLabel(value) {
        return clean(value).split(',').map(part => {
            const match = part.trim().match(/^([^:]+):(\d+(?:[.,]\d+)?)%$/);
            if (!match) return part.trim();
            return `${materials.get(match[1].trim()) || match[1].trim()}:${match[2]}%`;
        }).join(', ');
    }

    function makeHtml(product) {
        const extendedDescription = clean(product.extendedDescription);
        const intro = translate(product.seriesIntroTextShort || product.seoDescription || product.description);
        const features = [
            product.shapeDescription,
            product.paddingWiringText,
            product.transparencyText,
            product.strapsText,
            product.extraFeatureText,
            product.familyDescription
        ];
        const instructions = [
            product.bleachInstructions,
            product.dryCleanInstructions,
            product.dryInstructions,
            product.washInstructions,
            product.ironInstructions
        ].map(careLabel).filter(Boolean);
        const composition = compositionLabel(product.composition?.label || product.composition || '');

        return [
            extendedDescription ? `<p>${escapeHtml(extendedDescription)}</p>` : '',
            '<p><strong>Productinformatie</strong></p>',
            intro ? `<p>${escapeHtml(intro)}</p>` : '',
            list(features),
            '<p><strong>Onderhoudsinstructies</strong></p>',
            list(instructions),
            '<p><strong>Productsamenstelling</strong></p>',
            composition ? `<p>${escapeHtml(composition)}</p>` : ''
        ].filter(Boolean).join('\n');
    }

    function setSeoDescription(value) {
        const textarea = document.querySelector('textarea[name="meta[nl][description]"]');
        if (!textarea) return false;

        textarea.value = clean(value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function setEditorContent(html) {
        const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const tiny = page.tinyMCE || page.tinymce;
        const editor = tiny?.get?.('mce_1') || tiny?.getInstanceById?.('mce_1') ||
            tiny?.editors?.find(item => item.id === 'mce_1' || item.getContainer?.()?.id === 'mce_1_tbl');
        if (editor?.setContent) {
            editor.setContent(html);
            editor.save?.();
            editor.fire?.('change');
            editor.fireEvent?.('onChange', editor);
            return true;
        }

        const iframe = document.querySelector('#mce_1_ifr');
        if (iframe?.contentDocument?.body) {
            iframe.contentDocument.body.innerHTML = html;
            iframe.contentDocument.body.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }
        return false;
    }

    function getProduct(pid) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: API + encodeURIComponent(pid),
                // Deze headers bepalen bij Van de Velde de Nederlandse B2B-lokalisatie.
                headers: {
                    Accept: 'application/json',
                    'Accept-Language': 'nl,en-US;q=0.9,en;q=0.8,nl-NL;q=0.7',
                    Channel: 'b2b',
                    ClientId: 'eur',
                    'Content-Language': 'nl-BE',
                    Dyconsent: 'false'
                },
                timeout: 20000,
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`API-fout ${response.status}`));
                        return;
                    }
                    try { resolve(JSON.parse(response.responseText)); }
                    catch { reject(new Error('De API gaf geen geldige JSON terug.')); }
                },
                onerror: () => reject(new Error('De API is niet bereikbaar.')),
                ontimeout: () => reject(new Error('De API reageert niet op tijd.'))
            });
        });
    }

    async function generate(button) {
        if (!allowedBrand()) return;
        const pid = supplierPid();
        if (!pid) {
            alert('Vul eerst een Supplier PID in.');
            return;
        }

        const oldText = button.textContent;
        button.disabled = true;
        button.textContent = 'Producttekst ophalen…';
        try {
            const product = await getProduct(pid);
            if (!setEditorContent(makeHtml(product))) {
                throw new Error('TinyMCE-veld mce_1 is niet gevonden.');
            }
            setSeoDescription(product.seoDescription);
            button.textContent = 'Producttekst ingevuld ✓';
            setTimeout(() => { button.textContent = oldText; }, 2500);
        } catch (error) {
            alert(`Producttekst niet ingevuld: ${error.message}`);
            button.textContent = oldText;
        } finally {
            button.disabled = false;
        }
    }

    function installButton() {
        if (document.getElementById(BUTTON_ID)) return;
        const pidInput = document.querySelector('input[name="supplier_pid"]');
        const editorTable = document.querySelector('#mce_1_tbl');
        if (!pidInput || !editorTable) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.id = BUTTON_ID;
        button.textContent = 'Genereer Van de Velde-producttekst';
        button.style.cssText = 'display:block;margin:0 0 .75em 0;padding:.55em .9em;cursor:pointer;';
        button.addEventListener('click', () => generate(button));
        editorTable.parentNode.insertBefore(button, editorTable);

        const refresh = () => { button.hidden = !allowedBrand(); };
        document.querySelector('select#brand[name="brand_id"]')?.addEventListener('change', refresh);
        refresh();
    }

    const observer = new MutationObserver(installButton);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    installButton();
})();
