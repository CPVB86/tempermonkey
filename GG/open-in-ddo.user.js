// ==UserScript==
// @name         GG | Open in DDO
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      1.0
// @description  Voeg een paarse "Open in DDO" pill toe op Goedgepickt orderpagina's voor Dutch Designers Outlet.
// @match        https://fm-e-warehousing.goedgepickt.nl/orders*
// @run-at       document-idle
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/open-in-ddo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/open-in-ddo.user.js
// ==/UserScript==

(function () {
    'use strict';

    const MAX_TRIES = 50; // ~5s bij 100ms
    let tries = 0;

    function init() {
        const webshopEl = document.querySelector('.webshopName');
        const titleSpans = document.querySelectorAll('.page_title span');

        if (!webshopEl || !titleSpans.length) {
            if (tries++ < MAX_TRIES) {
                return setTimeout(init, 100);
            }
            return;
        }

        const webshopName = webshopEl.textContent.trim();
        if (webshopName !== 'Dutch Designers Outlet') return;

        // Ordernummer uit "Bestelling 266461"
        let orderId = null;
        for (const span of titleSpans) {
            const txt = span.textContent.trim();
            const match = txt.match(/Bestelling\s+(\d+)/i);
            if (match) {
                orderId = match[1];
                break;
            }
        }
        if (!orderId) return;

        // Niet dubbel toevoegen
        if (document.querySelector('[data-ddo-pill="true"]')) return;

        // Zoek de bestaande "Aangemaakt via API" badge
        let apiBadge = null;
        const badges = document.querySelectorAll('.badge.label');
        for (const badge of badges) {
            if (badge.textContent.includes('Aangemaakt via API')) {
                apiBadge = badge;
                break;
            }
        }

        // --- Paarse "Open in DDO" pill ---
        const ddoLink = document.createElement('a');
        ddoLink.textContent = 'Open in DDO';
        ddoLink.href = 'https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=view&id=' + encodeURIComponent(orderId);
        ddoLink.target = '_blank';
        ddoLink.rel = 'noopener noreferrer';
        ddoLink.dataset.ddoPill = 'true';

        if (apiBadge) {
            ddoLink.className = apiBadge.className;
            const styleAttr = apiBadge.getAttribute('style');
            if (styleAttr) {
                ddoLink.setAttribute('style', styleAttr);
            }
        } else {
            ddoLink.className = 'badge label mt-2';
        }

        ddoLink.style.background = '#7b3cff';
        ddoLink.style.marginLeft = '4px';
        ddoLink.style.textDecoration = 'none';
        ddoLink.style.cursor = 'pointer';

        // --- Zwarte "Download Invoice" pill ---
        const invoiceLink = document.createElement('a');
        invoiceLink.textContent = 'Download Invoice';
        invoiceLink.href = 'https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=print&id=' + encodeURIComponent(orderId);
        invoiceLink.target = '_blank';
        invoiceLink.rel = 'noopener noreferrer';
        invoiceLink.dataset.ddoInvoicePill = 'true';

        if (apiBadge) {
            invoiceLink.className = apiBadge.className;
            const styleAttr2 = apiBadge.getAttribute('style');
            if (styleAttr2) {
                invoiceLink.setAttribute('style', styleAttr2);
            }
        } else {
            invoiceLink.className = 'badge label mt-2';
        }

        invoiceLink.style.background = '#000000';
        invoiceLink.style.marginLeft = '4px';
        invoiceLink.style.textDecoration = 'none';
        invoiceLink.style.cursor = 'pointer';

        // Invoegen
        if (apiBadge && apiBadge.parentNode) {
            apiBadge.parentNode.insertBefore(ddoLink, apiBadge.nextSibling);
            ddoLink.insertAdjacentElement('afterend', invoiceLink);
        } else {
            const body = document.querySelector('.orderdetailscol .m-portlet__body');
            if (body) {
                body.appendChild(ddoLink);
                body.appendChild(invoiceLink);
            }
        }
    }

    init();
})();
