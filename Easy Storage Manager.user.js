// ==UserScript==
// @name         Easy Storage Manager
// @namespace    https://greasyfork.org/en/scripts/466806-easy-storage-manager
// @author       DevlinDelFuego
// @version      1.0
// @description  Easy Storage Manager is a handy script that allows you to easily export and import local storage data for WME.
// @match        *://*.waze.com/*editor*
// @exclude      *://*.waze.com/user/editor*
// @require      https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// ==/UserScript==

(function () {
    'use strict';

    // Export local storage data to a JSON file
    function exportLocalStorage() {
        const data = JSON.stringify(localStorage, null, 2);
        const file = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = 'local_storage_data.json';
        a.click();
    }

    // Import local storage data from a JSON file
    function importLocalStorage() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = function (event) {
            const file = event.target.files[0];
            const reader = new FileReader();
            reader.onload = function () {
                try {
                    const data = JSON.parse(reader.result);
                    localStorage.clear();
                    Object.assign(localStorage, data);
                    alert('Import successful');
                } catch (error) {
                    alert('Import failed. Error occurred while importing data.');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // Create and add the tab for the script
    function addScriptTab() {
        if (typeof W === 'undefined' || typeof WazeWrap === 'undefined') {
            console.log('WazeWrap is not available. Exiting script.');
            return;
        }

        const scriptId = 'easy-storage-manager-tab';
        const { tabLabel, tabPane } = W.userscripts.registerSidebarTab(scriptId);

        tabLabel.innerText = 'ESM';
        tabLabel.title = 'Easy Storage Manager';

        const description = document.createElement('p');
        description.style.fontWeight = 'bold';
        description.textContent = 'Easy Storage Manager';
        tabPane.appendChild(description);

        const text = document.createElement('p');
        text.textContent = 'Choose between importing a JSON file or exporting your current tab into a JSON file.';
        tabPane.appendChild(text);

        const importButton = document.createElement('button');
        importButton.textContent = 'Import JSON File';
        importButton.addEventListener('click', importLocalStorage);

        const exportButton = document.createElement('button');
        exportButton.textContent = 'Export JSON File';
        exportButton.addEventListener('click', exportLocalStorage);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.textAlign = 'center';
        buttonContainer.style.marginTop = '10px';
        buttonContainer.appendChild(importButton);
        buttonContainer.appendChild(document.createTextNode(' ')); // Add spacing between buttons
        buttonContainer.appendChild(exportButton);

        tabPane.appendChild(buttonContainer);

        const madeBy = document.createElement('p');
        madeBy.textContent = 'Made by DevlinDelFuego';
        madeBy.style.margin = '0';

        const version = document.createElement('p');
        version.textContent = 'Version: 1.0';
        version.style.margin = '0';

        tabPane.appendChild(document.createElement('br')); // Add space between buttons and text
        tabPane.appendChild(madeBy);
        tabPane.appendChild(version);
    }

    // Initialize the script
    function initialize() {
        if (W?.userscripts?.state.isReady) {
            addScriptTab();
        } else {
            document.addEventListener('wme-ready', addScriptTab, { once: true });
        }
    }

    // Call the initialize function
    initialize();
})();
