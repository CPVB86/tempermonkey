// ==UserScript==
// @name         GG | Open in DDO
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      1.2
// @description  Voegt DDO-, MSP-, factuur- en kopieerknoppen toe op Goedgepickt orderpagina's voor Dutch Designers Outlet.
// @match        https://fm-e-warehousing.goedgepickt.nl/orders*
// @run-at       document-idle
// @grant        GM_setClipboard
// @author       Chantor van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/open-in-ddo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/open-in-ddo.user.js
// ==/UserScript==

(function () {
    'use strict';

    const MAX_TRIES = 100;
    let tries = 0;

    /**
     * Hergebruik de opmaak van de bestaande API-badge.
     */
    function applyBadgeStyle(element, apiBadge) {
        if (apiBadge) {
            element.className = apiBadge.className;

            const styleAttribute = apiBadge.getAttribute('style');
            if (styleAttribute) {
                element.setAttribute('style', styleAttribute);
            }
        } else {
            element.className = 'badge label mt-2';
        }

        element.style.marginLeft = '4px';
        element.style.textDecoration = 'none';
        element.style.cursor = 'pointer';
        element.style.border = 'none';
    }

    /**
     * Haal ordernummer uit bijvoorbeeld:
     * "Bestelling 274587"
     */
    function getOrderId() {
        const titleSpans = document.querySelectorAll('.page_title span');

        for (const span of titleSpans) {
            const text = span.textContent.trim();
            const match = text.match(/Bestelling\s+(\d+)/i);

            if (match) {
                return match[1];
            }
        }

        return null;
    }

    /**
     * Haal de klantnaam uit de adres-portlet.
     *
     * De naam staat als eerste tekstregel in de m-portlet__body.
     */
    function getCustomerName() {
        const bodies = document.querySelectorAll('.m-portlet__body');

        for (const body of bodies) {
            const mailLink = body.querySelector('a[href^="mailto:"]');
            if (!mailLink) continue;

            const clone = body.cloneNode(true);

            clone.querySelectorAll('a, i, br').forEach((element) => {
                if (element.tagName === 'BR') {
                    element.replaceWith('\n');
                } else {
                    element.remove();
                }
            });

            const lines = clone.textContent
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);

            if (lines.length) {
                return lines[0];
            }
        }

        return null;
    }

    /**
     * Haal de eerste Track & Trace-link uit de zendingentabel.
     */
    function getShipmentData() {
        const table = document.querySelector('#order_shipment_overview_datatable');
        if (!table) return null;

        const trackingLink = table.querySelector(
            'tbody td:first-child a[href]'
        );

        if (!trackingLink) return null;

        const tracking = trackingLink.textContent.trim();
        const url = trackingLink.href;

        if (!tracking || !url) return null;

        return {
            tracking,
            url
        };
    }

    /**
     * Kopieer tekst naar het klembord.
     */
    async function copyToClipboard(text) {
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, 'text');
            return;
        }

        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';

        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        const successful = document.execCommand('copy');
        textarea.remove();

        if (!successful) {
            throw new Error('Kopiëren naar klembord is mislukt.');
        }
    }

    function init() {
        const webshopElement = document.querySelector('.webshopName');
        const orderId = getOrderId();

        if (!webshopElement || !orderId) {
            if (tries++ < MAX_TRIES) {
                setTimeout(init, 100);
            }
            return;
        }

        const webshopName = webshopElement.textContent.trim();

        if (webshopName !== 'Dutch Designers Outlet') {
            return;
        }

        // Niet dubbel toevoegen.
        if (
            document.querySelector('[data-ddo-pill="true"]') ||
            document.querySelector('[data-msp-pill="true"]') ||
            document.querySelector('[data-ddo-invoice-pill="true"]') ||
            document.querySelector('[data-ddo-copy-pill="true"]')
        ) {
            return;
        }

        // Zoek bestaande badge "Aangemaakt via API".
        let apiBadge = null;

        const badges = document.querySelectorAll('.badge.label');

        for (const badge of badges) {
            if (badge.textContent.includes('Aangemaakt via API')) {
                apiBadge = badge;
                break;
            }
        }

        // Paarse "Open in DDO"-pill.
        const ddoLink = document.createElement('a');
        ddoLink.textContent = 'Open in DDO';
        ddoLink.href =
            'https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=view&id=' +
            encodeURIComponent(orderId);
        ddoLink.target = '_blank';
        ddoLink.rel = 'noopener noreferrer';
        ddoLink.dataset.ddoPill = 'true';

        applyBadgeStyle(ddoLink, apiBadge);
        ddoLink.style.background = '#7b3cff';

        // Blauwe "Open in MSP"-pill.
        const mspLink = document.createElement('a');
        mspLink.textContent = 'Open in MSP';
        mspLink.href =
            'https://merchant.multisafepay.com/allpayments?options.query=' +
            encodeURIComponent(orderId);
        mspLink.target = '_blank';
        mspLink.rel = 'noopener noreferrer';
        mspLink.dataset.mspPill = 'true';

        applyBadgeStyle(mspLink, apiBadge);
        mspLink.style.background = '#00abee';

        // Zwarte "Download Invoice"-pill.
        const invoiceLink = document.createElement('a');
        invoiceLink.textContent = 'Download Invoice';
        invoiceLink.href =
            'https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=print&id=' +
            encodeURIComponent(orderId);
        invoiceLink.target = '_blank';
        invoiceLink.rel = 'noopener noreferrer';
        invoiceLink.dataset.ddoInvoicePill = 'true';

        applyBadgeStyle(invoiceLink, apiBadge);
        invoiceLink.style.background = '#000000';

        // Roze kopieerknop.
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.innerHTML = 'Copy Tracking';
        copyButton.dataset.ddoCopyPill = 'true';
        copyButton.title = 'Kopieer naam, ordernummer en Track & Trace';
        copyButton.setAttribute(
            'aria-label',
            'Kopieer naam, ordernummer en Track & Trace'
        );

        applyBadgeStyle(copyButton, apiBadge);

        copyButton.style.background = '#e83e8c';
        copyButton.style.color = '#ffffff';
        copyButton.style.minWidth = '28px';
        copyButton.style.height = '22px';
        copyButton.style.padding = '2px 8px';
        copyButton.style.verticalAlign = 'middle';

        copyButton.addEventListener('click', async function () {
            const customerName = getCustomerName();
            const shipment = getShipmentData();

            if (!customerName) {
                console.error('[GG | Open in DDO] Klantnaam niet gevonden.');
                copyButton.title = 'Klantnaam niet gevonden';
                return;
            }

            if (!shipment) {
                console.error(
                    '[GG | Open in DDO] Track & Trace niet gevonden.'
                );
                copyButton.title = 'Track & Trace niet gevonden';
                return;
            }

            const clipboardText = [
                customerName,
                orderId,
                shipment.tracking,
                shipment.url
            ].join('\t');

            try {
                await copyToClipboard(clipboardText);

                const originalHtml = copyButton.innerHTML;
                const originalTitle = copyButton.title;

                copyButton.innerHTML =
                    '<i class="fa fa-check" aria-hidden="true"></i>';
                copyButton.title = 'Gekopieerd!';
                copyButton.style.background = '#28a745';

                console.log(
                    '[GG | Open in DDO] Gekopieerd:',
                    clipboardText
                );

                setTimeout(() => {
                    copyButton.innerHTML = originalHtml;
                    copyButton.title = originalTitle;
                    copyButton.style.background = '#e83e8c';
                }, 1500);
            } catch (error) {
                console.error(
                    '[GG | Open in DDO] Kopiëren mislukt:',
                    error
                );

                copyButton.innerHTML =
                    '<i class="fa fa-times" aria-hidden="true"></i>';
                copyButton.title = 'Kopiëren mislukt';
                copyButton.style.background = '#dc3545';
            }
        });

        // Invoegen: DDO → MSP → Invoice → Copy.
        if (apiBadge && apiBadge.parentNode) {
            apiBadge.parentNode.insertBefore(
                ddoLink,
                apiBadge.nextSibling
            );

            ddoLink.insertAdjacentElement('afterend', mspLink);
            mspLink.insertAdjacentElement('afterend', invoiceLink);
            invoiceLink.insertAdjacentElement('afterend', copyButton);
        } else {
            const body = document.querySelector(
                '.orderdetailscol .m-portlet__body'
            );

            if (body) {
                body.appendChild(ddoLink);
                body.appendChild(mspLink);
                body.appendChild(invoiceLink);
                body.appendChild(copyButton);
            }
        }
    }

    init();
})();
