// ==UserScript==
// @name         DDO | PhotoLoco
// @namespace    https://tampermonkey.net/
// @version      1.1
// @description  Kies meerdere afbeeldingen tegelijk en vul image[0..4] automatisch, gesorteerd op _1, _2, _3, etc.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/photoloco.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/photoloco.user.js
// ==/UserScript==

(function () {
  'use strict';

  function createSingleFileList(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    return dt.files;
  }

  function emptyFileList() {
    return new DataTransfer().files;
  }

  function extractOrderNumber(filename) {
    const base = filename.replace(/\.[^/.]+$/, '');
    const match = base.match(/(?:_|-)(\d+)$/);
    return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
  }

  function sortFilesBySuffix(files) {
    return [...files].sort((a, b) => {
      const numA = extractOrderNumber(a.name);
      const numB = extractOrderNumber(b.name);

      if (numA !== numB) return numA - numB;

      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: 'base'
      });
    });
  }

  function updateStatusBox(statusBox, inputs) {
    const lines = inputs.map((input, index) => {
      const file = input.files && input.files[0];
      return `image[${index}]: ${file ? file.name : '— leeg —'}`;
    });

    statusBox.innerHTML = lines.map(line => `<div>${line}</div>`).join('');
  }

  function enhanceImageRow() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"][name^="image["]'));
    if (!inputs.length) return;

    const parentCell = inputs[0].closest('td');
    if (!parentCell) return;

    if (parentCell.querySelector('.tm-multi-image-helper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'tm-multi-image-helper';
    wrapper.style.margin = '10px 0';
    wrapper.style.padding = '10px';
    wrapper.style.border = '1px solid #ccc';
    wrapper.style.background = '#f9f9f9';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Kies meerdere afbeeldingen';
    button.style.marginRight = '10px';
    button.style.cursor = 'pointer';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Leegmaken';
    clearButton.style.cursor = 'pointer';

    const hiddenPicker = document.createElement('input');
    hiddenPicker.type = 'file';
    hiddenPicker.multiple = true;
    hiddenPicker.accept = 'image/*';
    hiddenPicker.style.display = 'none';

    const info = document.createElement('div');
    info.style.marginTop = '8px';
    info.style.fontSize = '12px';
    info.style.color = '#555';
    info.textContent = `Selecteer maximaal ${inputs.length} afbeeldingen.`;

    const statusBox = document.createElement('div');
    statusBox.style.marginTop = '8px';
    statusBox.style.fontSize = '12px';
    statusBox.style.lineHeight = '1.5';

    button.addEventListener('click', () => {
      hiddenPicker.click();
    });

    hiddenPicker.addEventListener('change', () => {
      let files = Array.from(hiddenPicker.files || []);
      if (!files.length) return;

      files = sortFilesBySuffix(files);

      if (files.length > inputs.length) {
        alert(`Je hebt ${files.length} bestanden gekozen. Alleen de eerste ${inputs.length} worden ingevuld.`);
      }

      inputs.forEach((input, index) => {
        const file = files[index];

        try {
          input.files = file ? createSingleFileList(file) : emptyFileList();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (err) {
          console.warn(`Kon image[${index}] niet vullen`, err);
        }
      });

      updateStatusBox(statusBox, inputs);
    });

    clearButton.addEventListener('click', () => {
      inputs.forEach((input) => {
        try {
          input.value = '';
          input.files = emptyFileList();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (err) {
          input.value = '';
        }
      });

      hiddenPicker.value = '';
      updateStatusBox(statusBox, inputs);
    });

    inputs.forEach(input => {
      input.addEventListener('change', () => updateStatusBox(statusBox, inputs));
    });

    wrapper.appendChild(button);
    wrapper.appendChild(clearButton);
    wrapper.appendChild(hiddenPicker);
    wrapper.appendChild(info);
    wrapper.appendChild(statusBox);

    parentCell.insertBefore(wrapper, parentCell.firstChild);
    updateStatusBox(statusBox, inputs);
  }

  function init() {
    enhanceImageRow();

    const observer = new MutationObserver(() => {
      enhanceImageRow();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
