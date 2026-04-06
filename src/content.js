/**
 * TrueGender Content Script v2
 * Profile-aware replacement engine with per-rule stats.
 * Uses TreeWalker + MutationObserver for performance.
 */

(function () {
  'use strict';

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'KBD', 'SAMP',
    'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH',
  ]);

  let settings = {
    enabled: true,
    gender: 'g',        // m | w | g | n | c
    partizip: true,
    doppelformen: true,
    categories: {},      // per-category overrides
    whitelist: [],
    blacklist: [],
    customRules: [],
    customReplacements: {}, // { ruleId: "custom text" }
  };

  let compiledRules = [];
  let replacementCount = 0;
  let ruleHits = {};    // { ruleId: count } — per-page session
  let rulesData = null;

  // ─── Load rules ─────────────────────────────────────────────────────────────

  async function loadRules() {
    const url = chrome.runtime.getURL('rules/rules.json');
    const resp = await fetch(url);
    rulesData = await resp.json();
    compileRules();
  }

  function isCategoryEnabled(categoryKey, category) {
    // Check per-category override from settings
    if (settings.categories && settings.categories[categoryKey] !== undefined) {
      return settings.categories[categoryKey];
    }
    // Legacy settings
    if (categoryKey === 'partizip') return settings.partizip;
    if (categoryKey === 'doppelformen') return settings.doppelformen;
    return category.enabled;
  }

  function compileRules() {
    compiledRules = [];
    if (!rulesData) return;

    for (const [categoryKey, category] of Object.entries(rulesData.rules)) {
      if (!isCategoryEnabled(categoryKey, category)) continue;

      for (const rule of category.rules) {
        try {
          const regex = new RegExp(rule.pattern, rule.flags || 'g');
          compiledRules.push({
            id: rule.id,
            regex,
            replacement: rule.replacement,
          });
        } catch (e) {
          console.warn(`[TrueGender] Invalid regex in rule ${rule.id}:`, e);
        }
      }
    }

    // Append user-created custom regex rules
    if (settings.customRules && settings.customRules.length > 0) {
      for (const rule of settings.customRules) {
        try {
          const regex = new RegExp(rule.pattern, 'g');
          compiledRules.push({
            id: 'custom-' + rule.pattern,
            regex,
            replacement: { m: rule.m, w: rule.w, g: rule.g, n: rule.n || rule.g, c: rule.c || '' },
          });
        } catch (e) {
          console.warn('[TrueGender] Invalid custom rule:', rule.pattern, e);
        }
      }
    }
  }

  // ─── Replacement engine ─────────────────────────────────────────────────────

  function getReplacementForRule(rule) {
    const gender = settings.gender;

    // Custom profile: check customReplacements first
    if (gender === 'c') {
      const custom = settings.customReplacements[rule.id];
      if (custom !== undefined && custom !== '') return custom;
      // Fall back to generic masculine
      return rule.replacement.g;
    }

    return rule.replacement[gender] || rule.replacement.g;
  }

  function replaceText(text) {
    let result = text;
    let count = 0;

    for (const rule of compiledRules) {
      rule.regex.lastIndex = 0;
      const replacement = getReplacementForRule(rule);
      const newText = result.replace(rule.regex, replacement);
      if (newText !== result) {
        rule.regex.lastIndex = 0;
        const matches = result.match(rule.regex);
        if (matches) {
          const matchCount = matches.length;
          count += matchCount;
          ruleHits[rule.id] = (ruleHits[rule.id] || 0) + matchCount;
        }
        result = newText;
      }
    }

    return { text: result, count };
  }

  // ─── DOM processing ─────────────────────────────────────────────────────────

  function shouldSkipNode(node) {
    if (!node.parentElement) return true;
    const tag = node.parentElement.tagName;
    if (SKIP_TAGS.has(tag)) return true;
    if (node.parentElement.isContentEditable) return true;
    if (node.parentElement.closest('[contenteditable="true"]')) return true;
    return false;
  }

  function processNode(textNode) {
    if (shouldSkipNode(textNode)) return 0;
    const original = textNode.textContent;
    if (!original || original.trim().length < 3) return 0;

    const { text, count } = replaceText(original);
    if (count > 0 && text !== original) {
      textNode.textContent = text;
      return count;
    }
    return 0;
  }

  function processTree(root) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let count = 0;
    let node;
    while ((node = walker.nextNode())) {
      count += processNode(node);
    }
    return count;
  }

  // ─── MutationObserver ───────────────────────────────────────────────────────

  let observer = null;
  let pendingMutations = [];
  let mutationTimer = null;

  function handleMutations(mutations) {
    if (!settings.enabled) return;

    pendingMutations.push(...mutations);
    if (mutationTimer) return;

    mutationTimer = setTimeout(() => {
      const nodes = new Set();
      for (const mutation of pendingMutations) {
        if (mutation.type === 'childList') {
          for (const added of mutation.addedNodes) {
            if (added.nodeType === Node.TEXT_NODE || added.nodeType === Node.ELEMENT_NODE) {
              nodes.add(added);
            }
          }
        } else if (mutation.type === 'characterData') {
          nodes.add(mutation.target);
        }
      }
      pendingMutations = [];
      mutationTimer = null;

      let count = 0;
      for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          count += processNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          count += processTree(node);
        }
      }

      if (count > 0) {
        replacementCount += count;
        sendStats();
      }
    }, 100);
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ─── Stats communication ────────────────────────────────────────────────────

  function sendStats() {
    chrome.runtime.sendMessage({
      type: 'updateStats',
      count: replacementCount,
      ruleHits,
      hostname: window.location.hostname,
    }).catch(() => {});
  }

  // ─── Domain check ──────────────────────────────────────────────────────────

  function isDomainAllowed() {
    const hostname = window.location.hostname;
    if (settings.blacklist.length > 0) {
      for (const domain of settings.blacklist) {
        if (hostname === domain || hostname.endsWith('.' + domain)) return false;
      }
    }
    if (settings.whitelist.length > 0) {
      for (const domain of settings.whitelist) {
        if (hostname === domain || hostname.endsWith('.' + domain)) return true;
      }
      return false;
    }
    return true;
  }

  // ─── Settings listener ─────────────────────────────────────────────────────

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;

    let needReprocess = false;
    let needRecompile = false;

    for (const [key, change] of Object.entries(changes)) {
      switch (key) {
        case 'enabled':
          settings.enabled = change.newValue;
          if (!settings.enabled) { stopObserver(); return; }
          needReprocess = true;
          break;
        case 'gender':
          settings.gender = change.newValue;
          needReprocess = true;
          break;
        case 'partizip':
        case 'doppelformen':
          settings[key] = change.newValue;
          needRecompile = true;
          needReprocess = true;
          break;
        case 'categories':
          settings.categories = change.newValue || {};
          needRecompile = true;
          needReprocess = true;
          break;
        case 'customReplacements':
          settings.customReplacements = change.newValue || {};
          needReprocess = true;
          break;
        case 'customRules':
          settings.customRules = change.newValue || [];
          needRecompile = true;
          needReprocess = true;
          break;
        case 'whitelist':
          settings.whitelist = change.newValue || [];
          break;
        case 'blacklist':
          settings.blacklist = change.newValue || [];
          break;
      }
    }

    if (needRecompile) compileRules();

    if (needReprocess && settings.enabled && isDomainAllowed()) {
      replacementCount = 0;
      ruleHits = {};
      replacementCount = processTree(document.body);
      sendStats();
      startObserver();
    }
  });

  // ─── Message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'getCount') {
      sendResponse({ count: replacementCount });
    }
    if (msg.type === 'getSelection') {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      let context = '';
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const container = range.startContainer;
        if (container.textContent) {
          context = container.textContent.substring(
            Math.max(0, range.startOffset - 40),
            Math.min(container.textContent.length, range.endOffset + 40)
          );
        }
      }
      sendResponse({ text, context });
    }
    if (msg.type === 'reprocess') {
      replacementCount = 0;
      ruleHits = {};
      replacementCount = processTree(document.body);
      sendStats();
      sendResponse({ count: replacementCount });
    }
  });

  // ─── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    const stored = await chrome.storage.sync.get({
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

    Object.assign(settings, stored);

    if (!settings.enabled) return;
    if (!isDomainAllowed()) return;

    await loadRules();

    replacementCount = processTree(document.body);
    sendStats();
    startObserver();
  }

  init();
})();
