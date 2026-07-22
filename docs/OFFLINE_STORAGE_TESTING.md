# Offline Storage Testing Guide

This guide provides step-by-step instructions for inspecting, clearing, and testing the offline database (IndexedDB) in WorkSphere using browser Developer Tools.

## 1. Inspecting IndexedDB Tables in DevTools

You can view the raw data stored in your local offline database directly from your browser.

### In Google Chrome / Edge

1. Open the Developer Tools by pressing `F12` or `Ctrl + Shift + I` (`Cmd + Option + I` on macOS).
2. Navigate to the **Application** tab at the top.
3. In the left sidebar, expand the **Storage** section, then expand **IndexedDB**.
4. Click on the WorkSphere database (e.g., `worksphere-offline-db`).
5. You will see a list of object stores (tables). Click on any table to view its stored records in the main pane.
6. To refresh the data, click the **Refresh** icon above the data table.

### In Mozilla Firefox

1. Open the Developer Tools by pressing `F12` or `Ctrl + Shift + I` (`Cmd + Option + I` on macOS).
2. Navigate to the **Storage** tab at the top.
3. In the left sidebar, expand the **Indexed DB** section.
4. Expand the WorkSphere database origin (e.g., `http://localhost:3000`).
5. Click on the database name to reveal the object stores.
6. Click on a specific store to inspect the key-value entries.

---

## 2. Clearing the Offline Database Store

If you need to reset your local environment or clear corrupted data, you can clear the database entirely.

### Option A: Using DevTools (UI)

1. Open the **Application** tab (Chrome) or **Storage** tab (Firefox).
2. Navigate to **Storage > IndexedDB** and click on the specific database.
3. Click the **Delete database** button at the top of the viewing pane.

### Option B: Using Code / Console

You can clear specific object stores programmatically. Run the following snippet in the browser console, or integrate it into your test setup:

```javascript
/**
 * Clears all data from a specific IndexedDB store.
 * @param {string} dbName - The name of the database.
 * @param {string} storeName - The name of the object store to clear.
 */
function clearOfflineStore(dbName, storeName) {
  const request = indexedDB.open(dbName);

  request.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);

    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      console.log(`Successfully cleared the '${storeName}' store.`);
    };

    clearRequest.onerror = (err) => {
      console.error(`Failed to clear store:`, err);
    };
  };

  request.onerror = (err) => {
    console.error(`Failed to open database:`, err);
  };
}

// Example usage:
// clearOfflineStore('worksphere-offline-db', 'venues');
```

---

## 3. Simulating Network Disconnection

Testing offline capabilities requires simulating a loss of network connectivity.

### In Chrome / Edge

1. Open the Developer Tools (`F12`).
2. Navigate to the **Network** tab.
3. Locate the throttling dropdown (usually says "No throttling" by default).
4. Select **Offline** from the dropdown menu.
5. A warning icon will appear on the Network tab, indicating that the browser is now simulating an offline state. All network requests will fail, triggering the service worker and offline IndexedDB fallbacks.

### In Firefox

1. Open the Developer Tools (`F12`).
2. Navigate to the **Network** tab.
3. Locate the throttling dropdown (default is "No throttling").
4. Select **Offline**.
