// ==UserScript==
// @name         DDO | Row Edit Icon
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      1.1
// @description  Voeg per rij een icoon toe dat linkt naar de Goto-editpagina (size/type/categorie/etc.)
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/row-edit.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/row-edit.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Pak alle rijen met class "highlight" (zoals in je HTML-dumps)
    const rows = document.querySelectorAll('tr.highlight');
    if (!rows.length) return;

    rows.forEach(row => {
        // Voorkom dubbele icoontjes
        if (row.dataset.editIconAdded === '1') return;

        const onmousedown = row.getAttribute('onmousedown') || '';
        const match = onmousedown.match(/Goto\('([^']+)'\)/);

        // Geen Goto? Dan niets te doen.
        if (!match) return;

        const editUrl = match[1]; // bijvoorbeeld: admin.php?section=categories&action=edit&id=2

        const cells = row.querySelectorAll('td.control');
        if (!cells.length) return;

        const firstCell = cells[0];

        // Icoon-link aanmaken
        const iconLink = document.createElement('a');
        iconLink.href = editUrl;
        iconLink.title = 'Naar bewerkpagina';
        iconLink.textContent = '⚙️'; // pas gerust aan naar 📝, 🔗, etc.
        iconLink.style.marginLeft = '0.5em';
        iconLink.style.textDecoration = 'none';

        // Icoon rechts achter de tekst in de eerste kolom plakken
        firstCell.appendChild(iconLink);

        row.dataset.editIconAdded = '1';
    });
})();
