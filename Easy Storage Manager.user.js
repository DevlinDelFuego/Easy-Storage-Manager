// ==UserScript==
// @name         Easy Storage Manager
// @namespace    https://greasyfork.org/en/scripts/466806-easy-storage-manager
// @author       DevlinDelFuego
// @version      2023.6.20.1
// @description  Easy Storage Manager is a handy script that allows you to easily export and import local storage data for WME.
// @match        *://*.waze.com/*editor*
// @exclude      *://*.waze.com/user/editor*
// @grant        none
// @require      https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @license      GPLv3
// ==/UserScript==

(function () {
  'use strict';

  let importedData; // Imported JSON data
  let applyButton; // Apply button element
  let scriptVersion = GM_info.script.version;
  const updateMessage = "<b>Changelog</b><br><br> -You can now select what settings you want to import. <br> -The script will now refresh the page after importing the settings. <br><br>";

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
          importedData = data;
          displayKeyList(Object.entries(importedData));
          applyButton.style.display = 'block'; // Show the apply button after generating the key list
          alert('Import successful');
        } catch (error) {
          // Only display the error message if the import fails
          console.error(error);
        }
      };
      reader.onerror = function () {
        alert('Error occurred while reading the file. Please try again.');
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // Display the list of keys for selection
  function displayKeyList(keyValuePairs) {
    const container = document.getElementById('key-list-container');
    container.innerHTML = ''; // Clear existing list

    // Select All button
    const selectAllButton = document.createElement('button');
    selectAllButton.textContent = 'Select All';
    selectAllButton.addEventListener('click', function () {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((checkbox) => {
        checkbox.checked = true;
      });
    });
    container.appendChild(selectAllButton);

    // Deselect All button
    const deselectAllButton = document.createElement('button');
    deselectAllButton.textContent = 'Deselect All';
    deselectAllButton.addEventListener('click', function () {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((checkbox) => {
        checkbox.checked = false;
      });
    });
    container.appendChild(deselectAllButton);

    container.appendChild(document.createElement('br'));

    // Key checkboxes
    keyValuePairs.forEach(([key, value]) => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = key;
      checkbox.value = key;
      checkbox.checked = true;
      container.appendChild(checkbox);

      const label = document.createElement('label');
      label.htmlFor = key;
      label.textContent = key;
      container.appendChild(label);

      const hiddenValue = document.createElement('input');
      hiddenValue.type = 'hidden';
      hiddenValue.value = value;
      container.appendChild(hiddenValue);

      container.appendChild(document.createElement('br'));
    });

    // Apply button
    applyButton = document.createElement('button');
    applyButton.textContent = 'Apply';
    applyButton.addEventListener('click', applyImport);
    container.appendChild(applyButton);
  }

  // Apply the selected key-value pairs from the JSON file
  function applyImport() {
    const selectedPairs = getSelectedPairs();
    if (selectedPairs.length === 0) {
      alert('No keys selected. Nothing to import.');
      return;
    }

    selectedPairs.forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });

    alert('Import successful');

    // Prompt to refresh the page
    if (confirm('The import was successful. Refresh the page to apply the changes?')) {
      location.reload();
    }
  }

  // Get the selected key-value pairs
  function getSelectedPairs() {
    const checkboxes = document.querySelectorAll('#key-list-container input[type="checkbox"]');
    const selectedPairs = [];
    checkboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        const key = checkbox.value;
        const value = checkbox.nextElementSibling.nextElementSibling.value;
        selectedPairs.push([key, value]);
      }
    });
    return selectedPairs;
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
    version.textContent = 'Version: ' + scriptVersion;
    version.style.margin = '0';

    tabPane.appendChild(document.createElement('br')); // Add space between buttons and text

    const keyListContainer = document.createElement('div');
    keyListContainer.id = 'key-list-container';
    tabPane.appendChild(keyListContainer);

    tabPane.appendChild(document.createElement('br')); // Add space between key list and apply button

    // Apply button (initially hidden)
    applyButton = document.createElement('button');
    applyButton.textContent = 'Apply';
    applyButton.addEventListener('click', applyImport);
    applyButton.style.display = 'none'; // Hide the apply button initially
    tabPane.appendChild(applyButton);

    tabPane.appendChild(document.createElement('br')); // Add space between Apply button and footer
    tabPane.appendChild(madeBy);
    tabPane.appendChild(version);
  }

   // Initialize the script
function initialize() {
  if (W?.userscripts?.state.isReady) {
    addScriptTab();
    showScriptUpdate();
  } else {
    document.addEventListener('wme-ready', function () {
      addScriptTab();
      showScriptUpdate();
    }, { once: true });
  }
}

// Call the initialize function
initialize();

// Show script update notification
function showScriptUpdate() {
  WazeWrap.Interface.ShowScriptUpdate(
    'Easy Storage Manager',
    GM_info.script.version,
    updateMessage,
    'https://greasyfork.org/en/scripts/466806-easy-storage-manager',
    'https://www.waze.com/forum/viewtopic.php?t=382966'
  );
}

})();