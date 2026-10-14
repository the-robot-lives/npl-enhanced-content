/**
 * extension/viewer.js — entry for the extension viewer tab (M2 raw path).
 *
 * The same trusted boot logic as the hosted viewer (vendor/viewer-boot.mjs —
 * copied from viewer/ by scripts/build-extension.mjs, never hand-edited).
 * Two surface differences (design §4.5/§6/§7):
 *
 *   1. the source URL comes from location.hash, not ?src=;
 *   2. consent "always allow" persists in chrome.storage.sync, not
 *      localStorage (write-through: the sync read is preloaded at module
 *      init; a late resolution only means one extra prompt — conservative).
 */

import { bootViewerWithSrc, setConsentStore } from './vendor/viewer-boot.mjs';
import { parseViewerHash } from './lib/raw-url.mjs';

const SYNC_KEY = 'semtext-viewer-allow-hosts';

/** Preload chrome.storage.sync; resolve to the stored host array. */
const syncRead = (chrome.storage && chrome.storage.sync
  ? chrome.storage.sync.get(SYNC_KEY).then((items) => {
      const raw = items && items[SYNC_KEY];
      return Array.isArray(raw) ? raw.filter((h) => typeof h === 'string') : [];
    })
  : Promise.resolve([])
).catch(() => []);

let knownHosts = [];
void syncRead.then((hosts) => {
  knownHosts = hosts;
});

setConsentStore({
  read() {
    return knownHosts;
  },
  write(hosts) {
    const set = new Set([...knownHosts, ...hosts]);
    knownHosts = [...set].sort();
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ [SYNC_KEY]: knownHosts }).catch(() => {
        /* sync unavailable — Allow-once semantics for this session */
      });
    }
  },
});

const parsed = parseViewerHash(location.hash);
if (parsed.ok) {
  bootViewerWithSrc(parsed.url);
} else {
  // Replace the hosted viewer's ?src= hint with the extension flow.
  const status = document.getElementById('viewer-status');
  if (status) {
    status.textContent = 'Open a raw .html file on GitHub and click "Render with SemText".';
  }
}
