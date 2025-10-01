// ==UserScript==
// @name         Easy Storage Manager
// @namespace    https://greasyfork.org/en/scripts/466806-easy-storage-manager
// @author       DevlinDelFuego, Gentleman_Hiwi
// @version      2025.09.28
// @description  Easy Storage Manager is a handy script that allows you to easily export and import local storage data for WME.
// @match        *://*.waze.com/*editor*
// @exclude      *://*.waze.com/user/editor*
// @grant        none
// @require      https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @license      GPLv3
// @downloadURL https://update.greasyfork.org/scripts/466806/Easy%20Storage%20Manager.user.js
// @updateURL https://update.greasyfork.org/scripts/466806/Easy%20Storage%20Manager.meta.js
// @run-at      document-start
// ==/UserScript==

(function () {
    'use strict';
  
  const ESM_DIAG = {
    log: (...args) => console.log('[ESM]', ...args),
    warn: (...args) => console.warn('[ESM]', ...args),
    error: (...args) => console.error('[ESM]', ...args)
  };
  window.addEventListener('error', (e) => {
    try { sessionStorage.setItem('ESM_DIAG_LAST_ERROR', `${e.message} at ${e.filename}:${e.lineno}`); } catch (err) {}
    ESM_DIAG.error('Unhandled error:', e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { sessionStorage.setItem('ESM_DIAG_LAST_REJECTION', String(e.reason)); } catch (err) {}
    ESM_DIAG.error('Unhandled rejection:', e.reason);
  });
  
    let importedData; // Imported JSON data
    let applyButton; // Apply button element
    let scriptVersion = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) ? GM_info.script.version : 'dev-local';
    const updateMessage = "<b>Changelog</b><br><br> - Full backup export/import now includes localStorage, sessionStorage, cookies, and IndexedDB. <br> - You can select which items to restore across all storage types and DB records. <br> - The page will refresh after importing to apply changes. <br><br>";
    const REAPPLY_STASH_KEY = 'ESM_POST_RELOAD';
  
    // Get safe, preferably native storage methods from a fresh iframe context (in case other scripts patch the prototype)
    function captureNativeStorage() {
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = 'about:blank';
        document.documentElement.appendChild(iframe);
        const win = iframe.contentWindow;
        const methods = {
          getItem: win.Storage.prototype.getItem,
          setItem: win.Storage.prototype.setItem,
          removeItem: win.Storage.prototype.removeItem,
          key: win.Storage.prototype.key
        };
        iframe.parentNode.removeChild(iframe);
        return methods;
      } catch (e) {
        // Fallback to current (possibly patched) prototype
        return {
          getItem: Storage.prototype.getItem,
          setItem: Storage.prototype.setItem,
          removeItem: Storage.prototype.removeItem,
          key: Storage.prototype.key
        };
      }
    }
    const NativeStorage = captureNativeStorage();
  
    // Early recovery attempt immediately after script start,
    // so that protected keys are activated before other user scripts, if possible
    try { reapplyAfterReload(); } catch (_) { /* ignore */ }
  
    // Export local storage data to a JSON file
    async function backupIndexedDB() {
      const result = [];
      let dbs = [];
      try {
        if (indexedDB.databases) {
          dbs = await indexedDB.databases();
        }
      } catch (e) {
        dbs = [];
      }
      for (const info of dbs) {
        if (!info || !info.name) continue;
        const name = info.name;
        const metaVersion = info.version;
        const backupForDb = await new Promise((resolve) => {
          const req = indexedDB.open(name);
          req.onerror = () => resolve(null);
          req.onupgradeneeded = () => {
            // No schema changes on read
          };
          req.onsuccess = () => {
            const db = req.result;
            const storeBackups = [];
            const stores = Array.from(db.objectStoreNames);
            const perStorePromises = stores.map((storeName) => new Promise((res) => {
              try {
                const tx = db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                const keyPath = store.keyPath || null;
                const autoIncrement = store.autoIncrement || false;
                const indexes = Array.from(store.indexNames).map((indexName) => {
                  const idx = store.index(indexName);
                  return { name: indexName, keyPath: idx.keyPath, unique: !!idx.unique, multiEntry: !!idx.multiEntry };
                });
                const out = { name: storeName, keyPath, autoIncrement, indexes, entries: [] };
                if (store.getAll && store.getAllKeys) {
                  const keysReq = store.getAllKeys();
                  const valsReq = store.getAll();
                  keysReq.onsuccess = () => {
                    const keys = keysReq.result || [];
                    valsReq.onsuccess = () => {
                      const vals = valsReq.result || [];
                      const len = Math.max(keys.length, vals.length);
                      for (let i = 0; i < len; i++) {
                        out.entries.push({ key: keys[i], value: vals[i] });
                      }
                      storeBackups.push(out);
                      res(true);
                    };
                    valsReq.onerror = () => { storeBackups.push(out); res(true); };
                  };
                  keysReq.onerror = () => { storeBackups.push(out); res(true); };
                } else {
                  const request = store.openCursor();
                  request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                      out.entries.push({ key: cursor.key, value: cursor.value });
                      cursor.continue();
                    } else {
                      storeBackups.push(out);
                      res(true);
                    }
                  };
                  request.onerror = () => { storeBackups.push(out); res(true); };
                }
              } catch (err) {
                res(true);
              }
            }));
            Promise.all(perStorePromises).then(() => {
              const backupObj = { name, version: db.version || metaVersion || null, stores: storeBackups };
              db.close();
              resolve(backupObj);
            });
          };
        });
        if (backupForDb) result.push(backupForDb);
      }
      return result;
    }
    async function exportLocalStorage() {
      const backup = {
        meta: {
          exportedAt: new Date().toISOString(),
          origin: location.origin,
          scriptVersion
        },
        // Robust: Determine keys and read values ​​via the native storage API
        localStorage: (() => {
          const out = {};
          try {
            const len = window.localStorage.length;
            for (let i = 0; i < len; i++) {
              const k = NativeStorage.key.call(window.localStorage, i);
              if (k != null) {
                out[k] = NativeStorage.getItem.call(window.localStorage, k);
              }
            }
          } catch (e) {
            // Fallback if another script has patched key()/getItem
            Object.keys(window.localStorage).forEach(k => {
              try { out[k] = window.localStorage.getItem(k); } catch (_) { out[k] = null; }
            });
          }
          return out;
        })(),
        sessionStorage: (() => {
          const out = {};
          try {
            const len = window.sessionStorage.length;
            for (let i = 0; i < len; i++) {
              const k = NativeStorage.key.call(window.sessionStorage, i);
              if (k != null) {
                out[k] = NativeStorage.getItem.call(window.sessionStorage, k);
              }
            }
          } catch (e) {
            Object.keys(window.sessionStorage).forEach(k => {
              try { out[k] = window.sessionStorage.getItem(k); } catch (_) { out[k] = null; }
            });
          }
          return out;
        })(),
        cookies: document.cookie
          .split(';')
          .map(c => {
            const [name, ...rest] = c.trim().split('=');
            return { name, value: rest.join('=') };
          })
          .filter(c => c.name),
        indexedDB: await backupIndexedDB()
      };
      const data = JSON.stringify(backup, null, 2);
      const file = new Blob([data], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `wme_settings_backup_${ts}.json`;
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
            const parsed = JSON.parse(reader.result);
            importedData = parsed;
            let keyValuePairs = [];
            const originOk = !(parsed && parsed.meta && parsed.meta.origin) || parsed.meta.origin === location.origin;
            if (parsed && typeof parsed === 'object' && (parsed.localStorage || parsed.sessionStorage || parsed.cookies || parsed.indexedDB)) {
              if (parsed.localStorage) {
                for (const [k, v] of Object.entries(parsed.localStorage)) {
                  keyValuePairs.push([`localStorage:${k}`, v]);
                }
              }
              if (parsed.sessionStorage && originOk) {
                for (const [k, v] of Object.entries(parsed.sessionStorage)) {
                  keyValuePairs.push([`sessionStorage:${k}`, v]);
                }
              }
              if (Array.isArray(parsed.cookies) && originOk) {
                for (const c of parsed.cookies) {
                  if (c && c.name != null) {
                    keyValuePairs.push([`cookie:${c.name}`, (c && typeof c.value !== 'undefined' && c.value !== null) ? c.value : '']);
                  }
                }
              }
              if (Array.isArray(parsed.indexedDB)) {
                for (const dbBackup of parsed.indexedDB) {
                  const dbName = (dbBackup && dbBackup.name) ? dbBackup.name : undefined;
                  if (!dbName || !Array.isArray(dbBackup.stores)) continue;
                  for (const storeBackup of dbBackup.stores) {
                    const storeName = (storeBackup && storeBackup.name) ? storeBackup.name : undefined;
                    if (!storeName || !Array.isArray(storeBackup.entries)) continue;
                    for (const entry of storeBackup.entries) {
                      const keyStr = JSON.stringify(entry.key);
                      const keyLabel = `indexedDB:${dbName}/${storeName}:${keyStr}`;
                      const valueObj = {
                        db: dbName,
                        store: storeName,
                        key: entry.key,
                        value: entry.value,
                        keyPath: (storeBackup && typeof storeBackup.keyPath !== 'undefined') ? storeBackup.keyPath : null,
                        autoIncrement: !!storeBackup.autoIncrement,
                        indexes: Array.isArray(storeBackup.indexes) ? storeBackup.indexes : []
                      };
                      keyValuePairs.push([keyLabel, valueObj]);
                    }
                  }
                }
              }
            } else {
              keyValuePairs = Object.entries(parsed);
            }
            displayKeyList(keyValuePairs);
            applyButton.style.display = 'block';
            if (!originOk) {
              alert('Note: The backup originates from a different source. For security reasons, cookies and session storage are not imported by default.');
            } else {
              alert('File read successfully');
            }
          } catch (error) {
            // Only display the error message if the import fails
            console.error(error);
            alert('File failed: Invalid JSON file.');
          };
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
        hiddenValue.value = typeof value === 'string' ? value : JSON.stringify(value);
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
    async function applyImport() {
      const selectedPairs = getSelectedPairs();
      if (selectedPairs.length === 0) {
        alert('No keys selected. Nothing to import.');
        return;
      }
  
      const { counts, failures } = await applyPairs(selectedPairs);
  
      const summary = `Import Completed\n- localStorage: ${counts.local}\n- sessionStorage: ${counts.session}\n- Cookies: ${counts.cookie}\n- IndexedDB: ${counts.idb}` + (failures.length ? `\n\nError (first ${Math.min(5, failures.length)}):\n${failures.slice(0,5).join('\n')}${failures.length > 5 ? `\n... (${failures.length - 5} more)` : ''}` : '');
      alert(summary);
  
      // Prompt to refresh the page
      if (confirm('The import was successful. Press ok to refresh page.')) {
        try {
          // Stash for post-reload reapply to prevent other scripts from overwriting restored values during startup
          sessionStorage.setItem(REAPPLY_STASH_KEY, JSON.stringify({ origin: location.origin, items: selectedPairs }));
        } catch (e) {
          // ignore stash errors
        }
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
          const valueStr = checkbox.nextElementSibling.nextElementSibling.value;
          // For IndexedDB entries, the value is JSON-encoded; for all other storages, the string must remain unchanged
          if (key.startsWith('indexedDB:')) {
            let parsedValue;
            try {
              parsedValue = JSON.parse(valueStr);
            } catch (e) {
              parsedValue = valueStr; // Fallback in case something unexpected happens
            }
            selectedPairs.push([key, parsedValue]);
          } else {
            selectedPairs.push([key, valueStr]);
          }
        }
      });
      return selectedPairs;
    }
  
    // Helper to apply selected pairs across storage types and IndexedDB (inside IIFE)
    async function applyPairs(selectedPairs) {
      const counts = { local: 0, session: 0, cookie: 0, idb: 0 };
      const failures = [];
      const sourceOrigin = (importedData && importedData.meta && importedData.meta.origin) ? importedData.meta.origin : undefined;
      const sameOrigin = !sourceOrigin || sourceOrigin === location.origin;
  
      for (const [fullKey, value] of selectedPairs) {
        try {
          const colonIdx = fullKey.indexOf(':');
          if (colonIdx < 0) {
            // Fallback: without type prefix we treat it as localStorage
            localStorage.setItem(fullKey, value);
            counts.local++;
            continue;
          }
          const type = fullKey.slice(0, colonIdx);
          const rest = fullKey.slice(colonIdx + 1);
  
          if (type === 'localStorage') {
            try {
              NativeStorage.setItem.call(window.localStorage, rest, value);
            } catch (_) {
              window.localStorage.setItem(rest, value);
            }
            counts.local++;
          } else if (type === 'sessionStorage') {
            if (!sameOrigin) {
              failures.push(`sessionStorage:${rest} skipped (Origin differs)`);
            } else {
              try {
                NativeStorage.setItem.call(window.sessionStorage, rest, value);
              } catch (_) {
                window.sessionStorage.setItem(rest, value);
              }
              counts.session++;
            }
          } else if (type === 'cookie') {
            if (!sameOrigin) {
              failures.push(`cookie:${rest} skipped (Origin differs)`);
            } else {
              // Set a session cookie (root path). An expiration date can be added if necessary.
              document.cookie = `${rest}=${value}; path=/`;
              counts.cookie++;
            }
          } else if (type === 'indexedDB') {
            try {
              // The value is already a complete record object (db, store, key, value, keyPath, autoIncrement, indexes)
              await writeIndexedDBRecord(value);
              counts.idb++;
            } catch (e) {
              failures.push(`indexedDB:${rest} -> ${e && e.message ? e.message : e}`);
            }
          } else {
            // Unknown type: treat as localStorage
            localStorage.setItem(rest, value);
            counts.local++;
          }
        } catch (err) {
          failures.push(`${fullKey} -> ${err && err.message ? err.message : err}`);
        }
      }
  
      return { counts, failures };
    }
  
    // Create and add the tab for the script (robust multi-path)
    function addScriptTab() {
      if (typeof window !== 'undefined' && window.uiMounted) {
        ESM_DIAG.log('UI already mounted, skipping addScriptTab');
        return;
      }
  
      const haveWUserscripts = typeof W !== 'undefined' && W && W.userscripts && typeof W.userscripts.registerSidebarTab === 'function';
      const haveWazeWrapTab = typeof WazeWrap !== 'undefined' && WazeWrap && WazeWrap.Interface && typeof WazeWrap.Interface.Tab === 'function';
  
      if (haveWUserscripts) {
        try {
          const scriptId = 'easy-storage-manager-tab';
          const { tabLabel, tabPane } = W.userscripts.registerSidebarTab(scriptId);
  
          tabLabel.innerText = '💾';
          tabLabel.title = 'Easy Storage Manager';
  
          const description = document.createElement('p');
          description.style.fontWeight = 'bold';
          description.textContent = 'Easy Storage Manager';
          tabPane.appendChild(description);
  
          const text = document.createElement('p');
          text.textContent = 'Import a backup JSON file or export a full backup (localStorage, sessionStorage, cookies, IndexedDB).';
          tabPane.appendChild(text);
  
          const importButton = document.createElement('button');
          importButton.textContent = '♻️ Import Backup';
          importButton.addEventListener('click', function() {
            if (typeof window.importLocalStorage === 'function') {
              window.importLocalStorage();
            } else if (typeof importLocalStorage === 'function') {
              importLocalStorage();
            } else {
              try { if (window.ESM_DIAG) window.ESM_DIAG.error('Import function not available'); } catch (_) {}
              alert('Import function not available');
            }
          });
          importButton.title = '♻️ Import Backup';
          importButton.style.backgroundImage = 'linear-gradient(180deg, #2196f3, #1976d2)';
          importButton.style.color = '#fff';
          importButton.style.border = 'none';
          importButton.style.borderRadius = '10px';
          importButton.style.padding = '8px 12px';
          importButton.style.fontWeight = '600';
          importButton.style.cursor = 'pointer';
          importButton.style.boxShadow = '0 3px 8px rgba(25, 118, 210, 0.35)';
          importButton.style.transition = 'transform 80ms ease, box-shadow 200ms ease, filter 200ms ease';
          importButton.style.whiteSpace = 'nowrap';
          importButton.style.display = 'inline-flex';
          importButton.style.alignItems = 'center';
          importButton.style.flex = '0 0 auto';
          importButton.style.gap = '4px';
          importButton.style.fontSize = '13px';
          importButton.style.lineHeight = '18px';
          importButton.style.width = 'auto';
          importButton.addEventListener('mouseenter', () => { importButton.style.filter = 'brightness(1.08)'; importButton.style.boxShadow = '0 6px 14px rgba(25,118,210,0.45)'; });
          importButton.addEventListener('mouseleave', () => { importButton.style.filter = ''; importButton.style.boxShadow = '0 3px 8px rgba(25,118,210,0.35)'; });
  
          const exportButton = document.createElement('button');
          exportButton.textContent = '📤 Export Backup';
          exportButton.addEventListener('click', function() {
            if (typeof window.exportLocalStorage === 'function') {
              window.exportLocalStorage();
            } else if (typeof exportLocalStorage === 'function') {
              exportLocalStorage();
            } else {
              try { if (window.ESM_DIAG) window.ESM_DIAG.error('Export function not available'); } catch (_) {}
              alert('Export function not available');
            }
          });
          exportButton.title = '📤 Export Backup';
          exportButton.style.backgroundImage = 'linear-gradient(180deg, #43a047, #2e7d32)';
          exportButton.style.color = '#fff';
          exportButton.style.border = 'none';
          exportButton.style.borderRadius = '10px';
          exportButton.style.padding = '8px 12px';
          exportButton.style.fontWeight = '600';
          exportButton.style.cursor = 'pointer';
          exportButton.style.boxShadow = '0 3px 8px rgba(46, 125, 50, 0.35)';
          exportButton.style.transition = 'transform 80ms ease, box-shadow 200ms ease, filter 200ms ease';
          exportButton.style.whiteSpace = 'nowrap';
          exportButton.style.display = 'inline-flex';
          exportButton.style.alignItems = 'center';
          exportButton.style.flex = '0 0 auto';
          exportButton.style.gap = '4px';
          exportButton.style.fontSize = '13px';
          exportButton.style.lineHeight = '18px';
          exportButton.style.width = 'auto';
          exportButton.addEventListener('mouseenter', () => { exportButton.style.filter = 'brightness(1.08)'; exportButton.style.boxShadow = '0 6px 14px rgba(46,125,50,0.45)'; });
          exportButton.addEventListener('mouseleave', () => { exportButton.style.filter = ''; exportButton.style.boxShadow = '0 3px 8px rgba(46,125,50,0.35)'; });
  
          const buttonContainer = document.createElement('div');
          buttonContainer.style.display = 'flex';
          buttonContainer.style.gap = '8px';
          buttonContainer.style.marginTop = '8px';
          buttonContainer.style.justifyContent = 'center';
          buttonContainer.style.alignItems = 'center';
          buttonContainer.style.width = '100%';
          buttonContainer.appendChild(importButton);
          buttonContainer.appendChild(exportButton);
          tabPane.appendChild(buttonContainer);
  
          const keyListContainer = document.createElement('div');
          keyListContainer.id = 'key-list-container';
          keyListContainer.style.marginTop = '10px';
          tabPane.appendChild(keyListContainer);
  
          if (typeof window !== 'undefined') window.uiMounted = true;
          ESM_DIAG.log('UI mounted via W.userscripts.registerSidebarTab');
          return;
        } catch (e) {
          ESM_DIAG.error('Failed to mount via W.userscripts, falling back', e);
        }
      }
  
      if (haveWazeWrapTab) {
        try {
          const html = '<div id="esm-tab">\n' +
            '<p id="esm-title" style="font-weight:700;margin:0 0 6px 0;">Easy Storage Manager</p>\n' +
            '<p style="margin:0 0 8px 0;">Import a backup JSON file or export a full backup (localStorage, sessionStorage, cookies, IndexedDB).</p>\n' +
            '<div style="display:flex;gap:8px;margin-bottom:8px;justify-content:center;align-items:center;width:100%;">\n' +
            '  <button id="esm-import">♻️ Import Backup</button>\n' +
            '  <button id="esm-export">📤 Export Backup</button>\n' +
            '</div>\n' +
            '<div id="key-list-container" style="border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px;max-height:320px;overflow:auto;"></div>\n' +
            '</div>';
          new WazeWrap.Interface.Tab('Easy Storage Manager', html, () => {
            const importBtn = document.getElementById('esm-import');
            const exportBtn = document.getElementById('esm-export');
            if (importBtn) importBtn.addEventListener('click', function() { if (typeof window.importLocalStorage === 'function') { window.importLocalStorage(); } else { try { if (window.ESM_DIAG) window.ESM_DIAG.error('Import function not available'); } catch (_) {} alert('Import function not available'); } });
            if (exportBtn) exportBtn.addEventListener('click', function() { if (typeof window.exportLocalStorage === 'function') { window.exportLocalStorage(); } else { try { if (window.ESM_DIAG) window.ESM_DIAG.error('Export function not available'); } catch (_) {} alert('Export function not available'); } });
            // Apply compact styles for WazeWrap tab buttons
            if (importBtn) {
              importBtn.style.backgroundImage = 'linear-gradient(180deg, #2196f3, #1976d2)';
              importBtn.style.color = '#fff';
              importBtn.style.border = 'none';
              importBtn.style.borderRadius = '10px';
              importBtn.style.padding = '8px 12px';
              importBtn.style.fontWeight = '600';
              importBtn.style.cursor = 'pointer';
              importBtn.style.boxShadow = '0 3px 8px rgba(25, 118, 210, 0.35)';
              importBtn.style.transition = 'transform 80ms ease, box-shadow 200ms ease, filter 200ms ease';
              importBtn.style.whiteSpace = 'nowrap';
              importBtn.style.display = 'inline-flex';
              importBtn.style.alignItems = 'center';
              importBtn.style.gap = '4px';
              importBtn.style.fontSize = '13px';
              importBtn.style.lineHeight = '18px';
            }
            if (exportBtn) {
              exportBtn.style.backgroundImage = 'linear-gradient(180deg, #43a047, #2e7d32)';
              exportBtn.style.color = '#fff';
              exportBtn.style.border = 'none';
              exportBtn.style.borderRadius = '10px';
              exportBtn.style.padding = '8px 12px';
              exportBtn.style.fontWeight = '600';
              exportBtn.style.cursor = 'pointer';
              exportBtn.style.boxShadow = '0 3px 8px rgba(46, 125, 50, 0.35)';
              exportBtn.style.transition = 'transform 80ms ease, box-shadow 200ms ease, filter 200ms ease';
              exportBtn.style.whiteSpace = 'nowrap';
              exportBtn.style.display = 'inline-flex';
              exportBtn.style.alignItems = 'center';
              exportBtn.style.gap = '4px';
              exportBtn.style.fontSize = '13px';
              exportBtn.style.lineHeight = '18px';
            }
            if (typeof window !== 'undefined') window.uiMounted = true;
            ESM_DIAG.log('UI mounted via WazeWrap.Interface.Tab');
          });
          return;
        } catch (e) {
          ESM_DIAG.error('Failed to mount via WazeWrap.Interface.Tab, falling back', e);
        }
      }
  
      // Final fallback: floating panel
      createFallbackPanel();
    }
  
     // Initialize the script
  function initialize() {
    ESM_DIAG.log('initialize() called. document.readyState=', document.readyState);
    if (typeof W !== 'undefined' && W && W.userscripts && W.userscripts.state && W.userscripts.state.isReady) {
      ESM_DIAG.log('W.userscripts.state.isReady is true. Initializing UI.');
      addScriptTab();
      showScriptUpdate();
      reapplyAfterReload();
    } else {
      ESM_DIAG.log('Waiting for wme-ready event...');
      document.addEventListener('wme-ready', function () {
        ESM_DIAG.log('wme-ready event received. Initializing UI.');
        addScriptTab();
        showScriptUpdate();
        reapplyAfterReload();
      }, { once: true });
    }
  }
  
  // Call the initialize function
  initialize();
  
  // Show script update notification
  function showScriptUpdate() {
    if (typeof WazeWrap !== 'undefined' && WazeWrap && WazeWrap.Interface && typeof WazeWrap.Interface.ShowScriptUpdate === 'function') {
      WazeWrap.Interface.ShowScriptUpdate(
        'Easy Storage Manager',
        (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) ? GM_info.script.version : scriptVersion,
        updateMessage,
        'https://greasyfork.org/en/scripts/466806-easy-storage-manager',
        'https://www.waze.com/forum/viewtopic.php?t=382966'
      );
    } else {
      ESM_DIAG.warn('ShowScriptUpdate skipped: WazeWrap.Interface.ShowScriptUpdate not available yet.');
    }
  }
  
  // Reapply after reload if a stash exists (inside IIFE)
  function reapplyAfterReload() {
    let stashStr = null;
    try {
      stashStr = sessionStorage.getItem(REAPPLY_STASH_KEY);
    } catch (e) {
      stashStr = null;
    }
    if (!stashStr) { ESM_DIAG.log('No reapply stash found; skipping.'); return; }
    sessionStorage.removeItem(REAPPLY_STASH_KEY);
    ESM_DIAG.log('Reapply stash found. Parsing...');
    try {
      const stash = JSON.parse(stashStr);
      ESM_DIAG.log('Parsed stash items count:', Array.isArray(stash.items) ? stash.items.length : 0);
      if (!(stash && stash.origin === location.origin && Array.isArray(stash.items) && stash.items.length)) { ESM_DIAG.warn('Stash invalid or empty; skipping.'); return; }
  
      applyPairs(stash.items).then(({ counts, failures }) => {
        ESM_DIAG.log('Initial applyPairs after reload complete.', counts, failures.slice(0, 3));
        const summary = `Restored after reload executed.\n- localStorage: ${counts.local}\n- sessionStorage: ${counts.session}\n- Cookies: ${counts.cookie}\n- IndexedDB: ${counts.idb}` + (failures.length ? `\n\nError (first ${Math.min(5, failures.length)}):\n${failures.slice(0,5).join('\n')}${failures.length > 5 ? `\n... (${failures.length - 5} more)` : ''}` : '');
        try { alert(summary); } catch (e) {}
      }).catch((ex) => { ESM_DIAG.error('applyPairs after reload failed:', ex); });
  
      const desiredLocal = new Map();
      for (const [fullKey, value] of stash.items) {
        const idx = fullKey.indexOf(':');
        const type = idx < 0 ? 'localStorage' : fullKey.slice(0, idx);
        const name = idx < 0 ? fullKey : fullKey.slice(idx + 1);
        if (type === 'localStorage') {
          desiredLocal.set(name, value);
        }
      }
      ESM_DIAG.log('Desired localStorage keys:', Array.from(desiredLocal.keys()));
  
      const scheduleRepairs = (delaysMs) => {
        ESM_DIAG.log('Scheduling repairs with delays:', delaysMs);
        delaysMs.forEach(ms => {
          setTimeout(() => {
            const repairs = [];
            desiredLocal.forEach((desired, name) => {
              try {
                const current = NativeStorage.getItem.call(window.localStorage, name);
                if (current !== desired) {
                  ESM_DIAG.log('Repair needed for key:', name, 'current=', current, 'desired=', desired);
                  repairs.push([`localStorage:${name}`, desired]);
                } else {
                  ESM_DIAG.log('Key already correct:', name);
                }
              } catch (e) {
                ESM_DIAG.warn('Error reading key during repair check:', name, e);
              }
            });
            if (repairs.length) {
              ESM_DIAG.log('Applying repairs count:', repairs.length);
              applyPairs(repairs).catch((ex) => { ESM_DIAG.error('applyPairs repairs failed:', ex); });
            }
          }, ms);
        });
      };
  
      const originalSetItem = localStorage.setItem.bind(localStorage);
      const originalGetItem = localStorage.getItem.bind(localStorage);
      const originalRemoveItem = localStorage.removeItem.bind(localStorage);
      const originalClear = localStorage.clear.bind(localStorage);
      const originalProtoSetItem = Storage.prototype.setItem;
      const originalProtoGetItem = Storage.prototype.getItem;
      const originalProtoRemoveItem = Storage.prototype.removeItem;
      const originalProtoClear = Storage.prototype.clear;
      const protectMs = 120000; // 120s protection
      const protectUntil = Date.now() + protectMs;
      const protectedKeys = new Set(Array.from(desiredLocal.keys()));
  
      try {
        localStorage.setItem = function (key, value) {
          if (protectedKeys.has(key) && Date.now() < protectUntil) {
            ESM_DIAG.log('Protected setItem intercepted for key:', key);
            try { return NativeStorage.setItem.call(window.localStorage, key, desiredLocal.get(key)); } catch (e) { return; }
          }
          return originalSetItem(key, value);
        };
  
        localStorage.getItem = function (key) {
          if (protectedKeys.has(key) && Date.now() < protectUntil) {
            const desired = desiredLocal.get(key);
            ESM_DIAG.log('Protected getItem intercepted for key:', key);
            return typeof desired === 'string' ? desired : desired;
          }
          return NativeStorage.getItem.call(window.localStorage, key);
        };
  
        localStorage.removeItem = function (key) {
          if (protectedKeys.has(key) && Date.now() < protectUntil) {
            ESM_DIAG.log('Protected removeItem blocked for key:', key);
            try { return NativeStorage.setItem.call(window.localStorage, key, desiredLocal.get(key)); } catch (_) { return; }
          }
          return originalRemoveItem(key);
        };
  
        localStorage.clear = function () {
          if (Date.now() < protectUntil && protectedKeys.size) {
            ESM_DIAG.log('Protected clear intercepted; preserving keys:', Array.from(protectedKeys));
            try {
              const len = window.localStorage.length;
              const toRemove = [];
              for (let i = 0; i < len; i++) {
                const k = NativeStorage.key.call(window.localStorage, i);
                if (k != null && !protectedKeys.has(k)) toRemove.push(k);
              }
              toRemove.forEach(k => { try { originalRemoveItem(k); } catch (_) {} });
              return;
            } catch (_) { /* fallback */ }
          }
          return originalClear();
        };
  
        Storage.prototype.setItem = function (key, value) {
          const isLocal = this === window.localStorage || this === localStorage;
          if (isLocal && protectedKeys.has(key) && Date.now() < protectUntil) {
            ESM_DIAG.log('Prototype setItem intercepted for key:', key);
            try { return NativeStorage.setItem.call(window.localStorage, key, desiredLocal.get(key)); } catch (e) { return; }
          }
          return originalProtoSetItem.call(this, key, value);
        };
  
        Storage.prototype.getItem = function (key) {
          const isLocal = this === window.localStorage || this === localStorage;
          if (isLocal && protectedKeys.has(key) && Date.now() < protectUntil) {
            const desired = desiredLocal.get(key);
            ESM_DIAG.log('Prototype getItem intercepted for key:', key);
            return typeof desired === 'string' ? desired : desired;
          }
          return originalProtoGetItem.call(this, key);
        };
  
        Storage.prototype.removeItem = function (key) {
          const isLocal = this === window.localStorage || this === localStorage;
          if (isLocal && protectedKeys.has(key) && Date.now() < protectUntil) {
            ESM_DIAG.log('Prototype removeItem blocked for key:', key);
            try { return NativeStorage.setItem.call(window.localStorage, key, desiredLocal.get(key)); } catch (_) { return; }
          }
          return originalProtoRemoveItem.call(this, key);
        };
  
        Storage.prototype.clear = function () {
          const isLocal = this === window.localStorage || this === localStorage;
          if (isLocal && Date.now() < protectUntil && protectedKeys.size) {
            ESM_DIAG.log('Prototype clear intercepted; preserving keys:', Array.from(protectedKeys));
            try {
              const len = window.localStorage.length;
              const toRemove = [];
              for (let i = 0; i < len; i++) {
                const k = NativeStorage.key.call(window.localStorage, i);
                if (k != null && !protectedKeys.has(k)) toRemove.push(k);
              }
              toRemove.forEach(k => { try { originalRemoveItem(k); } catch (_) {} });
              return;
            } catch (_) { /* fallback */ }
          }
          return originalProtoClear.call(this);
        };
  
        ESM_DIAG.log('Protection overrides applied for keys:', Array.from(protectedKeys), 'until', new Date(protectUntil).toISOString());
      } catch (ex) {
        ESM_DIAG.error('Error applying protection overrides:', ex);
      }
  
      scheduleRepairs([500, 2000, 5000, 10000, 20000, 30000, 45000, 60000, 90000, 120000]);
    } catch (ex) {
      ESM_DIAG.error('Error parsing stash or scheduling repairs:', ex);
    }
  }
  
  // Export key functions to window for fallback usage
  if (typeof window !== 'undefined') {
    window.exportLocalStorage = exportLocalStorage;
    window.importLocalStorage = importLocalStorage;
  }
  
  // Properly close IIFE
  })();
  
  // Duplicate reapplyAfterReload removed; the IIFE version is used.
  
  async function writeIndexedDBRecord(record) {
    return new Promise((resolve, reject) => {
      const openReq = indexedDB.open(record.db);
      openReq.onerror = () => reject(openReq.error);
      openReq.onupgradeneeded = () => { /* no-op */ };
      openReq.onsuccess = () => {
        const db = openReq.result;
        const proceedWrite = () => {
          try {
            const tx = db.transaction([record.store], 'readwrite');
            const st = tx.objectStore(record.store);
            let req;
            if (st.keyPath) {
              req = st.put(record.value);
            } else {
              req = st.put(record.value, record.key);
            }
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => { db.close(); resolve(true); };
            tx.onerror = () => reject(tx.error);
          } catch (err) {
            reject(err);
          }
        };
        if (!db.objectStoreNames.contains(record.store)) {
          db.close();
          const bump = indexedDB.open(record.db, (db.version || 1) + 1);
          bump.onerror = () => reject(bump.error);
          bump.onupgradeneeded = (evt) => {
            const db2 = evt.target.result;
            if (!db2.objectStoreNames.contains(record.store)) {
              const opts = {};
              if (record.keyPath) opts.keyPath = record.keyPath;
              if (record.autoIncrement) opts.autoIncrement = true;
              const newStore = db2.createObjectStore(record.store, opts);
              if (Array.isArray(record.indexes)) {
                record.indexes.forEach(ix => {
                  try {
                    newStore.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry });
                  } catch (e) { /* ignore invalid index definitions */ }
                });
              }
            }
          };
          bump.onsuccess = () => {
            const db2 = bump.result;
            try {
              const tx = db2.transaction([record.store], 'readwrite');
              const st = tx.objectStore(record.store);
              let req;
              if (st.keyPath) {
                req = st.put(record.value);
              } else {
                req = st.put(record.value, record.key);
              }
              req.onerror = () => reject(req.error);
              tx.oncomplete = () => { db2.close(); resolve(true); };
              tx.onerror = () => reject(tx.error);
            } catch (err) {
              reject(err);
            }
          };
        } else {
          proceedWrite();
        }
      };
    });
  }
  
  // Duplicate applyPairs removed; using the in-IIFE implementation.
  let uiMounted = false;
  function ensureDOMReady(cb) {
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      try { cb(); } catch (e) { if (window.ESM_DIAG) window.ESM_DIAG.error('ensureDOMReady callback error', e); }
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        try { cb(); } catch (e) { if (window.ESM_DIAG) window.ESM_DIAG.error('ensureDOMReady DOMContentLoaded error', e); }
      }, { once: true });
    }
  }
  
  function createFallbackPanel() {
    ensureDOMReady(() => {
      if (window.uiMounted) return;
      const panel = document.createElement('div');
      panel.id = 'esm-fallback-panel';
      panel.style.position = 'fixed';
      panel.style.top = '72px';
      panel.style.right = '12px';
      panel.style.zIndex = '999999';
      panel.style.background = 'rgba(30, 41, 59, 0.93)';
      panel.style.backdropFilter = 'blur(4px)';
      panel.style.border = '1px solid rgba(255,255,255,0.12)';
      panel.style.borderRadius = '12px';
      panel.style.padding = '12px 14px';
      panel.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
      panel.style.color = '#eaeef5';
      panel.style.maxWidth = '420px';
      panel.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif';
  
      const title = document.createElement('div');
      title.textContent = 'Easy Storage Manager';
      title.style.fontWeight = '700';
      title.style.marginBottom = '6px';
      title.style.letterSpacing = '0.2px';
      panel.appendChild(title);
  
      const desc = document.createElement('div');
      desc.textContent = 'Fallback-Panel aktiv. Importiere/Exportiere Backups und wähle Schlüssel zur Wiederherstellung.';
      desc.style.fontSize = '12px';
      desc.style.opacity = '0.9';
      desc.style.marginBottom = '8px';
      panel.appendChild(desc);
  
      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.gap = '8px';
      btnRow.style.marginBottom = '10px';
      btnRow.style.justifyContent = 'center';
      btnRow.style.alignItems = 'center';
      btnRow.style.width = '100%';
      const importBtn = document.createElement('button');
      importBtn.id = 'esm-import-btn';
      importBtn.textContent = '♻️ Import Backup';
      importBtn.title = '♻️ Import Backup';
      importBtn.style.backgroundImage = 'linear-gradient(180deg, #2196f3, #1976d2)';
      importBtn.style.color = '#fff';
      importBtn.style.border = 'none';
      importBtn.style.borderRadius = '10px';
      importBtn.style.padding = '8px 12px';
      importBtn.style.fontWeight = '600';
      importBtn.style.cursor = 'pointer';
      importBtn.style.boxShadow = '0 3px 8px rgba(25, 118, 210, 0.35)';
      importBtn.style.transition = 'transform 80ms ease, box-shadow 200ms ease, filter 200ms ease';
      importBtn.style.whiteSpace = 'nowrap';
      importBtn.style.display = 'inline-flex';
      importBtn.style.alignItems = 'center';
      importBtn.style.gap = '4px';
      importBtn.style.fontSize = '13px';
      importBtn.style.lineHeight = '18px';
      importBtn.style.width = 'auto';
      importBtn.addEventListener('mouseenter', () => { importBtn.style.filter = 'brightness(1.08)'; importBtn.style.boxShadow = '0 6px 14px rgba(25,118,210,0.45)'; });
      importBtn.addEventListener('mouseleave', () => { importBtn.style.filter = ''; importBtn.style.boxShadow = '0 3px 8px rgba(25,118,210,0.35)'; });
      importBtn.addEventListener('click', function() {
        if (typeof window.importLocalStorage === 'function') {
          window.importLocalStorage();
        } else {
          try { if (window.ESM_DIAG) window.ESM_DIAG.error('Import function not available'); } catch (_) {}
          alert('Import function not available');
        }
      });
  
      const exportBtn = document.createElement('button');
      exportBtn.id = 'esm-export-btn';
      exportBtn.textContent = '📤 Export Backup';
      exportBtn.title = '📤 Export Backup';
      exportBtn.style.backgroundImage = 'linear-gradient(180deg, #43a047, #2e7d32)';
      exportBtn.style.color = '#fff';
      exportBtn.style.border = 'none';
      exportBtn.style.borderRadius = '10px';
      exportBtn.style.padding = '8px 12px';
      exportBtn.style.fontWeight = '600';
      exportBtn.style.cursor = 'pointer';
      exportBtn.style.boxShadow = '0 3px 8px rgba(46, 125, 50, 0.35)';
      exportBtn.style.transition = 'transform 80ms ease, box-shadow 200ms ease, filter 200ms ease';
      exportBtn.style.whiteSpace = 'nowrap';
      exportBtn.style.display = 'inline-flex';
      exportBtn.style.alignItems = 'center';
      exportBtn.style.gap = '4px';
      exportBtn.style.fontSize = '13px';
      exportBtn.style.lineHeight = '18px';
      exportBtn.style.width = 'auto';
      exportBtn.addEventListener('mouseenter', () => { exportBtn.style.filter = 'brightness(1.08)'; exportBtn.style.boxShadow = '0 6px 14px rgba(46,125,50,0.45)'; });
      exportBtn.addEventListener('mouseleave', () => { exportBtn.style.filter = ''; exportBtn.style.boxShadow = '0 3px 8px rgba(46,125,50,0.35)'; });
      exportBtn.addEventListener('click', function() {
        if (typeof window.exportLocalStorage === 'function') {
          window.exportLocalStorage();
        } else {
          try { if (window.ESM_DIAG) window.ESM_DIAG.error('Export function not available'); } catch (_) {}
          alert('Export function not available');
        }
      });
      btnRow.appendChild(importBtn);
      btnRow.appendChild(exportBtn);
      panel.appendChild(btnRow);
  
      const container = document.createElement('div');
      container.id = 'key-list-container';
      container.style.background = 'rgba(255,255,255,0.05)';
      container.style.border = '1px solid rgba(255,255,255,0.10)';
      container.style.borderRadius = '10px';
      container.style.padding = '10px';
      container.style.maxHeight = '320px';
      container.style.overflow = 'auto';
      panel.appendChild(container);
  
      document.body.appendChild(panel);
      window.uiMounted = true;
      if (typeof window !== 'undefined' && window.ESM_DIAG) window.ESM_DIAG.log('UI mounted via floating fallback panel');
    });
  }
  
  // Duplicate global addScriptTab removed; using the IIFE-scoped implementation exclusively.
  // UI mounting is managed inside the IIFE via initialize(); removing duplicate global function to avoid scope issues.
  if (typeof window !== 'undefined') {
    if (typeof exportLocalStorage === 'function') {
      window.exportLocalStorage = exportLocalStorage;
    }
    if (typeof importLocalStorage === 'function') {
      window.importLocalStorage = importLocalStorage;
    }
  }
