/**
 * TrueGender Options Page v2
 * Profile editor, import/export, stats, category toggles.
 */

document.addEventListener('DOMContentLoaded', async () => {

  let rulesData = null;

  // ─── Load all data ────────────────────────────────────────────────────────

  const settings = await chrome.storage.sync.get({
    gender: 'g',
    partizip: false,
    doppelformen: true,
    categories: {},
    whitelist: [],
    blacklist: [],
    customRules: [],
    customReplacements: {},
  });

  const localData = await chrome.storage.local.get({
    reportedWords: [],
    stats: { totalReplacements: 0, ruleHits: {}, domainHits: {} },
  });

  // Load rules.json
  try {
    const resp = await fetch(chrome.runtime.getURL('rules/rules.json'));
    rulesData = await resp.json();
  } catch (e) {
    console.error('[TrueGender] Failed to load rules:', e);
  }

  // ─── Toast ────────────────────────────────────────────────────────────────

  function showToast(msg) {
    const toast = document.getElementById('saveToast');
    toast.textContent = msg || 'Gespeichert';
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 1500);
  }

  // ─── Category name mapping ────────────────────────────────────────────────

  const CATEGORY_META = {
    genderStar: { title: 'Sonderzeichen-Formen', desc: 'Genderstern, Doppelpunkt, Unterstrich (*:_)' },
    binnenI: { title: 'Binnen-I', desc: 'MitarbeiterInnen, KollegInnen' },
    specificWords: { title: 'Spezifische Wörter', desc: 'Expert:innen, Kund:innen etc.' },
    articles: { title: 'Artikel & Pronomen', desc: 'der:die, ein:e, er:sie etc.' },
    doppelformen: { title: 'Doppelformen', desc: '„Bürgerinnen und Bürger", „er oder sie"' },
    partizip: { title: 'Partizip-Konstruktionen', desc: 'Studierende, Mitarbeitende, Lehrende' },
    slashForms: { title: 'Schrägstrich-Formen', desc: 'Lehrer/innen, Lehrer/-in' },
  };

  function isCatEnabled(key) {
    if (settings.categories[key] !== undefined) return settings.categories[key];
    if (key === 'partizip') return settings.partizip;
    if (key === 'doppelformen') return settings.doppelformen;
    if (rulesData && rulesData.rules[key]) return rulesData.rules[key].enabled;
    return true;
  }

  // ─── Profile selector ─────────────────────────────────────────────────────

  const profilePills = document.querySelectorAll('.profile-pill');
  profilePills.forEach((pill) => {
    if (pill.dataset.gender === settings.gender) pill.classList.add('active');
    else pill.classList.remove('active');

    pill.addEventListener('click', async () => {
      profilePills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      settings.gender = pill.dataset.gender;
      await chrome.storage.sync.set({ gender: pill.dataset.gender });
      showToast();
    });
  });

  // ─── Category toggles ────────────────────────────────────────────────────

  const catContainer = document.getElementById('categoryToggles');

  if (rulesData) {
    for (const [key, category] of Object.entries(rulesData.rules)) {
      const meta = CATEGORY_META[key] || { title: key, desc: category.description };
      const enabled = isCatEnabled(key);

      const row = document.createElement('div');
      row.className = 'option-row';
      row.innerHTML = `
        <div class="option-info">
          <div class="option-title">${meta.title}</div>
          <div class="option-desc">${meta.desc} (${category.rules.length} Regeln)</div>
        </div>
        <label class="toggle">
          <input type="checkbox" data-cat="${key}" ${enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      `;

      row.querySelector('input').addEventListener('change', async (e) => {
        settings.categories[key] = e.target.checked;
        // Keep legacy keys in sync
        if (key === 'partizip') settings.partizip = e.target.checked;
        if (key === 'doppelformen') settings.doppelformen = e.target.checked;
        await chrome.storage.sync.set({
          categories: settings.categories,
          partizip: settings.partizip,
          doppelformen: settings.doppelformen,
        });
        showToast();
      });

      catContainer.appendChild(row);
    }
  }

  // ─── Profile editor table ─────────────────────────────────────────────────

  const ruleTableBody = document.getElementById('ruleTableBody');
  const ruleSearch = document.getElementById('ruleSearch');
  let allRuleRows = [];

  function buildRuleTable() {
    ruleTableBody.innerHTML = '';
    allRuleRows = [];
    if (!rulesData) return;

    for (const [catKey, category] of Object.entries(rulesData.rules)) {
      const meta = CATEGORY_META[catKey] || { title: catKey };

      // Category header row
      const headerRow = document.createElement('tr');
      headerRow.className = 'cat-header';
      headerRow.innerHTML = `<td colspan="7">${meta.title} (${category.rules.length})</td>`;
      ruleTableBody.appendChild(headerRow);

      for (const rule of category.rules) {
        const tr = document.createElement('tr');
        tr.dataset.searchtext = `${rule.example || ''} ${rule.description} ${rule.id}`.toLowerCase();

        const customVal = settings.customReplacements[rule.id] || '';

        tr.innerHTML = `
          <td class="col-example">${escHtml(rule.example || rule.pattern.substring(0, 20))}</td>
          <td class="col-desc">${escHtml(rule.description)}</td>
          <td class="col-preset">${escHtml(rule.replacement.m || '')}</td>
          <td class="col-preset">${escHtml(rule.replacement.w || '')}</td>
          <td class="col-preset">${escHtml(rule.replacement.g || '')}</td>
          <td class="col-preset">${escHtml(rule.replacement.n || '')}</td>
          <td class="col-custom">
            <input type="text" data-rule-id="${rule.id}" value="${escAttr(customVal)}"
                   placeholder="—" class="${customVal ? 'has-value' : ''}">
          </td>
        `;

        const input = tr.querySelector('input');
        input.addEventListener('change', async () => {
          const val = input.value.trim();
          if (val) {
            settings.customReplacements[rule.id] = val;
            input.classList.add('has-value');
          } else {
            delete settings.customReplacements[rule.id];
            input.classList.remove('has-value');
          }
          await chrome.storage.sync.set({ customReplacements: settings.customReplacements });
          showToast();
        });

        ruleTableBody.appendChild(tr);
        allRuleRows.push(tr);
      }
    }
  }

  buildRuleTable();

  // Search filter
  ruleSearch.addEventListener('input', () => {
    const q = ruleSearch.value.toLowerCase().trim();
    for (const tr of allRuleRows) {
      tr.style.display = (!q || tr.dataset.searchtext.includes(q)) ? '' : 'none';
    }
  });

  // ─── Import / Export ──────────────────────────────────────────────────────

  document.getElementById('btnExport').addEventListener('click', async () => {
    const sync = await chrome.storage.sync.get({
      gender: 'g',
      categories: {},
      customReplacements: {},
      customRules: [],
    });

    const profile = {
      _truegender_profile: true,
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      gender: sync.gender,
      categories: sync.categories,
      customReplacements: sync.customReplacements,
      customRules: sync.customRules,
    };

    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `truegender-profil-${sync.gender}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Profil exportiert');
  });

  const importFile = document.getElementById('importFile');
  const importStatus = document.getElementById('importStatus');

  document.getElementById('btnImport').addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const profile = JSON.parse(text);

      if (!profile._truegender_profile) {
        importStatus.textContent = 'Ungültige Datei — kein TrueGender-Profil.';
        importStatus.style.color = '#c44';
        return;
      }

      // Apply imported profile
      const updates = {};
      if (profile.gender) updates.gender = profile.gender;
      if (profile.categories) updates.categories = profile.categories;
      if (profile.customReplacements) updates.customReplacements = profile.customReplacements;
      if (profile.customRules) updates.customRules = profile.customRules;

      await chrome.storage.sync.set(updates);
      Object.assign(settings, updates);

      // Refresh UI
      profilePills.forEach((p) => {
        p.classList.toggle('active', p.dataset.gender === settings.gender);
      });
      buildRuleTable();
      renderCustomRules(settings.customRules);

      importStatus.textContent = `Profil importiert (${Object.keys(profile.customReplacements || {}).length} Custom-Ersetzungen).`;
      importStatus.style.color = '#4a4';
      showToast('Profil importiert');
    } catch (err) {
      importStatus.textContent = 'Fehler beim Lesen der Datei: ' + err.message;
      importStatus.style.color = '#c44';
    }

    importFile.value = '';
  });

  document.getElementById('btnResetCustom').addEventListener('click', async () => {
    if (!confirm('Alle Custom-Ersetzungen wirklich zurücksetzen?')) return;
    settings.customReplacements = {};
    await chrome.storage.sync.set({ customReplacements: {} });
    buildRuleTable();
    showToast('Custom-Profil zurückgesetzt');
  });

  // ─── Domain lists ─────────────────────────────────────────────────────────

  function renderDomainList(container, list, storageKey) {
    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">Keine Einträge</div>';
      return;
    }
    for (const domain of list) {
      const item = document.createElement('div');
      item.className = 'domain-item';
      item.innerHTML = `<span>${escHtml(domain)}</span><button>Entfernen</button>`;
      item.querySelector('button').addEventListener('click', async () => {
        const current = await chrome.storage.sync.get({ [storageKey]: [] });
        const updated = current[storageKey].filter((d) => d !== domain);
        await chrome.storage.sync.set({ [storageKey]: updated });
        renderDomainList(container, updated, storageKey);
        showToast();
      });
      container.appendChild(item);
    }
  }

  const blacklistContainer = document.getElementById('blacklistContainer');
  const whitelistContainer = document.getElementById('whitelistContainer');

  renderDomainList(blacklistContainer, settings.blacklist, 'blacklist');
  renderDomainList(whitelistContainer, settings.whitelist, 'whitelist');

  document.getElementById('addBlacklist').addEventListener('click', async () => {
    const input = document.getElementById('blacklistInput');
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;
    const current = await chrome.storage.sync.get({ blacklist: [] });
    if (!current.blacklist.includes(domain)) {
      current.blacklist.push(domain);
      await chrome.storage.sync.set({ blacklist: current.blacklist });
      renderDomainList(blacklistContainer, current.blacklist, 'blacklist');
      showToast();
    }
    input.value = '';
  });

  document.getElementById('addWhitelist').addEventListener('click', async () => {
    const input = document.getElementById('whitelistInput');
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;
    const current = await chrome.storage.sync.get({ whitelist: [] });
    if (!current.whitelist.includes(domain)) {
      current.whitelist.push(domain);
      await chrome.storage.sync.set({ whitelist: current.whitelist });
      renderDomainList(whitelistContainer, current.whitelist, 'whitelist');
      showToast();
    }
    input.value = '';
  });

  // ─── Custom regex rules ───────────────────────────────────────────────────

  function renderCustomRules(rules) {
    const container = document.getElementById('customRulesContainer');
    container.innerHTML = '';
    if (rules.length === 0) {
      container.innerHTML = '<div class="empty-state">Keine eigenen Regeln</div>';
      return;
    }
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const item = document.createElement('div');
      item.className = 'custom-rule-item';
      item.innerHTML = `
        <div>
          <code>${escHtml(rule.pattern)}</code>
          <span style="margin-left: 8px; color: #888;">${escHtml(rule.description || '')}</span><br>
          <span style="color: #4A90D9;">m:</span> ${escHtml(rule.m || '—')}
          <span style="margin-left: 6px; color: #e5a;">w:</span> ${escHtml(rule.w || '—')}
          <span style="margin-left: 6px; color: #888;">g:</span> ${escHtml(rule.g || '—')}
          <span style="margin-left: 6px; color: #6a8;">n:</span> ${escHtml(rule.n || '—')}
        </div>
        <button style="color: #c44;">Entfernen</button>
      `;
      item.querySelector('button').addEventListener('click', async () => {
        const current = await chrome.storage.sync.get({ customRules: [] });
        current.customRules.splice(i, 1);
        await chrome.storage.sync.set({ customRules: current.customRules });
        renderCustomRules(current.customRules);
        showToast();
      });
      container.appendChild(item);
    }
  }

  renderCustomRules(settings.customRules);

  document.getElementById('addRule').addEventListener('click', async () => {
    const pattern = document.getElementById('rulePattern').value.trim();
    const desc = document.getElementById('ruleDesc').value.trim();
    const m = document.getElementById('ruleMale').value.trim();
    const w = document.getElementById('ruleFemale').value.trim();
    const g = document.getElementById('ruleGeneric').value.trim();
    const n = document.getElementById('ruleNeutral').value.trim();

    if (!pattern || (!m && !w && !g && !n)) return;

    try { new RegExp(pattern, 'g'); }
    catch { alert('Ungültiger regulärer Ausdruck!'); return; }

    const current = await chrome.storage.sync.get({ customRules: [] });
    current.customRules.push({ pattern, description: desc, m, w, g, n });
    await chrome.storage.sync.set({ customRules: current.customRules });
    renderCustomRules(current.customRules);

    ['rulePattern', 'ruleDesc', 'ruleMale', 'ruleFemale', 'ruleGeneric', 'ruleNeutral']
      .forEach((id) => { document.getElementById(id).value = ''; });
    showToast();
  });

  // ─── Statistics ───────────────────────────────────────────────────────────

  function renderStats() {
    const stats = localData.stats;

    document.getElementById('statTotal').textContent = (stats.totalReplacements || 0).toLocaleString('de-DE');

    // Count active rules
    let ruleCount = 0;
    if (rulesData) {
      for (const [key, cat] of Object.entries(rulesData.rules)) {
        if (isCatEnabled(key)) ruleCount += cat.rules.length;
      }
    }
    ruleCount += settings.customRules.length;
    document.getElementById('statRules').textContent = ruleCount;

    const domainCount = Object.keys(stats.domainHits || {}).length;
    document.getElementById('statDomains').textContent = domainCount;

    // Top 10 rules
    const topRulesContainer = document.getElementById('topRules');
    const ruleEntries = Object.entries(stats.ruleHits || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (ruleEntries.length === 0) {
      topRulesContainer.innerHTML = '<div class="empty-state">Noch keine Daten</div>';
    } else {
      // Build rule ID → description map
      const ruleDescMap = {};
      if (rulesData) {
        for (const cat of Object.values(rulesData.rules)) {
          for (const rule of cat.rules) {
            ruleDescMap[rule.id] = rule.example || rule.description;
          }
        }
      }
      topRulesContainer.innerHTML = ruleEntries.map(([id, count]) =>
        `<div class="stats-item"><span>${escHtml(ruleDescMap[id] || id)}</span><span class="count">${count.toLocaleString('de-DE')}</span></div>`
      ).join('');
    }

    // Top 5 domains
    const topDomainsContainer = document.getElementById('topDomains');
    const domainEntries = Object.entries(stats.domainHits || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (domainEntries.length === 0) {
      topDomainsContainer.innerHTML = '<div class="empty-state">Noch keine Daten</div>';
    } else {
      topDomainsContainer.innerHTML = domainEntries.map(([domain, count]) =>
        `<div class="stats-item"><span>${escHtml(domain)}</span><span class="count">${count.toLocaleString('de-DE')}</span></div>`
      ).join('');
    }
  }

  renderStats();

  document.getElementById('btnResetStats').addEventListener('click', async () => {
    if (!confirm('Statistiken wirklich zurücksetzen?')) return;
    localData.stats = { totalReplacements: 0, ruleHits: {}, domainHits: {} };
    await chrome.storage.local.set({ stats: localData.stats });
    renderStats();
    showToast('Statistiken zurückgesetzt');
  });

  // ─── Reported words ───────────────────────────────────────────────────────

  function renderReported(words) {
    const container = document.getElementById('reportedContainer');
    container.innerHTML = '';
    if (words.length === 0) {
      container.innerHTML = '<div class="empty-state">Keine gemeldeten Wörter</div>';
      return;
    }
    for (const entry of words) {
      const item = document.createElement('div');
      item.className = 'reported-item';
      const date = new Date(entry.timestamp).toLocaleDateString('de-DE');
      let html = `<div>
        <span class="reported-word">${escHtml(entry.word)}</span>
        <span style="color: #aaa;"> — ${escHtml(entry.url || '?')}</span>`;
      if (entry.context) {
        html += `<br><span class="reported-context">„${escHtml(entry.context)}"</span>`;
      }
      html += `</div><span class="reported-date">${date}</span>`;
      item.innerHTML = html;
      container.appendChild(item);
    }
  }

  renderReported(localData.reportedWords);

  document.getElementById('clearReported').addEventListener('click', async () => {
    await chrome.storage.local.set({ reportedWords: [] });
    renderReported([]);
    showToast('Gelöscht');
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function escHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function escAttr(s) {
    return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});
