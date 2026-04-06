/**
 * TrueGender Background Service Worker v2
 * Badge updates, per-rule stats, per-domain stats.
 */

// ─── Default settings on install ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.sync.set({
      enabled: true,
      gender: 'g',
      partizip: true,
      doppelformen: true,
      categories: {},
      whitelist: [],
      blacklist: [],
      customRules: [],
      customReplacements: {},
    });
    await chrome.storage.local.set({
      reportedWords: [],
      stats: {
        totalReplacements: 0,
        ruleHits: {},    // { ruleId: totalCount }
        domainHits: {},  // { hostname: totalCount }
      },
    });
  }

  // Migrate: add missing stats keys for existing installs
  if (details.reason === 'update') {
    const local = await chrome.storage.local.get({ stats: {} });
    const stats = local.stats;
    if (!stats.ruleHits) stats.ruleHits = {};
    if (!stats.domainHits) stats.domainHits = {};
    if (!stats.totalReplacements) stats.totalReplacements = 0;
    await chrome.storage.local.set({ stats });

    // Ensure new sync keys exist
    const sync = await chrome.storage.sync.get({});
    const defaults = {};
    if (sync.categories === undefined) defaults.categories = {};
    if (sync.customReplacements === undefined) defaults.customReplacements = {};
    if (Object.keys(defaults).length > 0) {
      await chrome.storage.sync.set(defaults);
    }
  }
});

// ─── Stats + badge updates from content script ──────────────────────────────

const tabCounts = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'updateStats' && sender.tab) {
    const tabId = sender.tab.id;
    const count = msg.count || 0;
    tabCounts.set(tabId, count);

    // Badge
    const text = count > 0 ? String(count) : '';
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#4A90D9', tabId });

    // Persist stats
    chrome.storage.local.get({ stats: { totalReplacements: 0, ruleHits: {}, domainHits: {} } }, (data) => {
      const stats = data.stats;
      stats.totalReplacements += count;

      // Per-rule hits
      if (msg.ruleHits) {
        for (const [ruleId, hits] of Object.entries(msg.ruleHits)) {
          stats.ruleHits[ruleId] = (stats.ruleHits[ruleId] || 0) + hits;
        }
      }

      // Per-domain hits
      if (msg.hostname && count > 0) {
        stats.domainHits[msg.hostname] = (stats.domainHits[msg.hostname] || 0) + count;
      }

      chrome.storage.local.set({ stats });
    });
  }

  // Return rules.json data to popup/options for preview
  if (msg.type === 'getRulesData') {
    fetch(chrome.runtime.getURL('rules/rules.json'))
      .then((r) => r.json())
      .then((data) => sendResponse(data))
      .catch(() => sendResponse(null));
    return true; // async sendResponse
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabCounts.delete(tabId);
});

// Reset badge on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabCounts.set(tabId, 0);
    chrome.action.setBadgeText({ text: '', tabId });
  }
});

// Clear badges when disabled
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled !== undefined && !changes.enabled.newValue) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.action.setBadgeText({ text: '', tabId: tab.id });
      }
    });
  }
});
