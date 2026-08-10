// ==UserScript==
// @name         DDO | VIP prijs beheer
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      1.3
// @description  Blokkeert VIP nulprijzen en kan via het hoofdveld alle VIP-prijzen uitschakelen.
// @author       C. P. v. Beek
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/vip-prijs-beheer.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/vip-prijs-beheer.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VIP_SELECTOR = 'input[name$="[price_vip]"]';

    function log(...args) {
        console.log('[DDO VIP]', ...args);
    }

    /**
     * Controleer of een waarde 0 is.
     */
    function isZero(value) {
        const number = parseFloat(
            String(value ?? '')
                .trim()
                .replace(',', '.')
        );

        return !Number.isNaN(number) && number === 0;
    }

    /**
     * Input/change-events afvuren zodat bestaande
     * scripts op de DDO-pagina wijzigingen meekrijgen.
     */
    function fireEvents(input) {
        input.dispatchEvent(
            new Event('input', {
                bubbles: true
            })
        );

        input.dispatchEvent(
            new Event('change', {
                bubbles: true
            })
        );
    }

    /**
     * =========================================================
     * VARIANT VIP-VELDEN
     * =========================================================
     */

    /**
     * VIP = 0:
     *
     * - zichtbaar houden
     * - readonly
     * - niet met Tab bereikbaar
     * - niet aanklikbaar
     */
    function lockZeroVip(input) {
        input.readOnly = true;
        input.tabIndex = -1;

        input.dataset.ddoVipLocked = '1';
    }

    /**
     * VIP > 0:
     * normaal invoerveld.
     */
    function unlockVip(input) {
        input.readOnly = false;

        if (input.dataset.ddoVipLocked === '1') {
            input.removeAttribute('tabindex');
        }

        delete input.dataset.ddoVipLocked;
    }

    /**
     * Analyseer alle variant VIP-velden.
     *
     * BELANGRIJK:
     * Er worden hier GEEN knoppen toegevoegd.
     */
    function analyseVariantVipFields() {
        const vipInputs = [
            ...document.querySelectorAll(VIP_SELECTOR)
        ];

        log(
            `Gevonden variant VIP-inputs: ${vipInputs.length}`
        );

        vipInputs.forEach(input => {
            if (isZero(input.value)) {
                lockZeroVip(input);
            } else {
                unlockVip(input);
            }
        });
    }

    /**
     * Zet alle variant-VIP's op 0.00.
     */
    function zeroAllVariantVipFields() {
        const inputs = [
            ...document.querySelectorAll(VIP_SELECTOR)
        ];

        inputs.forEach(input => {
            input.value = '0.00';

            fireEvents(input);

            lockZeroVip(input);
        });

        log(
            `${inputs.length} variant VIP-prijzen op 0 gezet`
        );
    }

    /**
     * =========================================================
     * HOOFD VIP-VELD OP TAB 1
     * =========================================================
     */

    /**
     * Zoek losse VIP-inputs die NIET de variantvelden zijn.
     *
     * De variantvelden hebben namen zoals:
     *
     * options[2117938][price_vip]
     */
    function findMainVipFields() {
        return [...document.querySelectorAll('input')]
            .filter(input => {

                // Variantvelden uitsluiten
                if (input.matches(VIP_SELECTOR)) {
                    return false;
                }

                // Niet bruikbare inputtypes uitsluiten
                if (
                    input.type === 'hidden' ||
                    input.type === 'submit' ||
                    input.type === 'button' ||
                    input.type === 'checkbox' ||
                    input.type === 'radio'
                ) {
                    return false;
                }

                const haystack = [
                    input.name || '',
                    input.id || '',
                    input.className || ''
                ]
                    .join(' ')
                    .toLowerCase();

                return haystack.includes('vip');
            });
    }

    /**
     * Voeg inline 0-knop toe naast het hoofd VIP-veld.
     */
    function setupMainVipField() {
        const fields = findMainVipFields();

        log(
            `Mogelijke hoofd VIP-velden gevonden: ${fields.length}`
        );

        fields.forEach(input => {

            /**
             * Zoek bestaande knop die bij DIT veld hoort.
             */
            let button = input.nextElementSibling;

            if (
                button &&
                button.classList.contains(
                    'ddo-vip-main-zero-button'
                )
            ) {
                /**
                 * Als de VIP inmiddels nul is,
                 * knop verwijderen.
                 */
                if (isZero(input.value)) {
                    button.remove();
                }

                return;
            }

            /**
             * Bij hoofdprijs 0 is geen knop nodig.
             */
            if (isZero(input.value)) {
                return;
            }

            button = document.createElement('button');

            button.type = 'button';
            button.className =
                'ddo-vip-main-zero-button';

            button.title =
                'VIP-prijs uitschakelen en alle VIP-prijzen op 0 zetten';

            button.textContent = '0';

            button.addEventListener(
                'click',
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    /**
                     * Hoofd VIP op nul.
                     */
                    input.value = '0.00';

                    fireEvents(input);

                    /**
                     * Alle variantprijzen ook op nul.
                     */
                    zeroAllVariantVipFields();

                    /**
                     * Opnieuw analyseren.
                     */
                    analyseVariantVipFields();

                    /**
                     * Hoofdknop verwijderen.
                     */
                    button.remove();

                    log(
                        'Hoofd-VIP + alle variant VIP-prijzen op 0 gezet'
                    );
                }
            );

            /**
             * Exact direct achter input plaatsen.
             */
            input.insertAdjacentElement(
                'afterend',
                button
            );

            log(
                'Hoofd VIP-knop toegevoegd:',
                input.name || input.id || input
            );
        });
    }

    /**
     * =========================================================
     * STYLING
     * =========================================================
     */

    function addStyles() {
        if (
            document.getElementById(
                'ddo-vip-styles'
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id = 'ddo-vip-styles';

        style.textContent = `

            /*
             * Hoofd VIP 0-knop op tab 1
             */
            .ddo-vip-main-zero-button {
                display: inline-flex !important;

                align-items: center;
                justify-content: center;

                box-sizing: border-box;

                width: 26px;
                min-width: 26px;
                height: 24px;

                margin: 0 0 0 5px !important;
                padding: 0 !important;

                position: static !important;
                float: none !important;

                border: 0 !important;
                border-radius: 5px;

                background: #dc3545;
                color: #fff;

                font-size: 12px;
                font-weight: bold;
                line-height: 1;

                cursor: pointer;

                vertical-align: middle;
            }

            .ddo-vip-main-zero-button:hover {
                filter: brightness(.85);
            }

            /*
             * VIP = 0:
             *
             * Wel zichtbaar,
             * maar duidelijk geblokkeerd.
             */
            input[data-ddo-vip-locked="1"] {
                pointer-events: none !important;

                cursor: not-allowed !important;

                opacity: .6;
            }
        `;

        document.head.appendChild(style);
    }

    /**
     * =========================================================
     * RUN
     * =========================================================
     */

    function run() {
        analyseVariantVipFields();
        setupMainVipField();
    }

    function init() {
        log('Script gestart');

        addStyles();

        run();

        /**
         * DDO initialiseert mogelijk onderdelen
         * van de tabs later.
         */
        setTimeout(run, 250);
        setTimeout(run, 750);
        setTimeout(run, 1500);
        setTimeout(run, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            init
        );
    } else {
        init();
    }

})();
