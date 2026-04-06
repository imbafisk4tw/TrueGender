/**
 * TrueGender Popup Script v2
 * Profile dropdown, tooltips, selection-based report.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const toggleLabel = document.getElementById('toggleLabel');
  const profileBtns = document.querySelectorAll('.profile-btn');
  const counterEl = document.getElementById('counter');
  const currentDomainEl = document.getElementById('currentDomain');
  const btnBlock = document.getElementById('btnBlock');
  const btnAllow = document.getElementById('btnAllow');
  const reportWord = document.getElementById('reportWord');
  const btnReport = document.getElementById('btnReport');
  const btnFromSelection = document.getElementById('btnFromSelection');
  const reportHint = document.getElementById('reportHint');
  const reportSuccess = document.getElementById('reportSuccess');
  const openOptions = document.getElementById('openOptions');

  // ─── Load settings ────────────────────────────────────────────────────────

  const settings = await chrome.storage.sync.get({
    enabled: true,
    gender: 'g',
    whitelist: [],
    blacklist: [],
  });

  // ─── Enable toggle ────────────────────────────────────────────────────────

  enableToggle.checked = settings.enabled;
  toggleLabel.textContent = settings.enabled ? 'An' : 'Aus';

  enableToggle.addEventListener('change', async () => {
    const enabled = enableToggle.checked;
    toggleLabel.textContent = enabled ? 'An' : 'Aus';
    await chrome.storage.sync.set({ enabled });
  });

  // ─── Profile selection ────────────────────────────────────────────────────

  profileBtns.forEach((btn) => {
    if (btn.dataset.gender === settings.gender) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }

    btn.addEventListener('click', async () => {
      profileBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      await chrome.storage.sync.set({ gender: btn.dataset.gender });
    });
  });

  // ─── Counter + domain ─────────────────────────────────────────────────────

  let currentTab = null;
  let hostname = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'getCount' }, (response) => {
        if (chrome.runtime.lastError) {
          counterEl.textContent = '—';
          return;
        }
        counterEl.textContent = response?.count ?? 0;
      });

      if (tab.url) {
        try {
          hostname = new URL(tab.url).hostname;
          currentDomainEl.textContent = hostname;

          if (settings.blacklist.includes(hostname)) {
            btnBlock.classList.add('active-block');
            btnBlock.textContent = 'Blockiert';
          }
          if (settings.whitelist.includes(hostname)) {
            btnAllow.classList.add('active-allow');
            btnAllow.textContent = 'Erlaubt';
          }
        } catch {
          currentDomainEl.textContent = '—';
        }
      }
    }
  } catch {
    counterEl.textContent = '—';
  }

  // ─── Block / Allow ────────────────────────────────────────────────────────

  btnBlock.addEventListener('click', async () => {
    if (!hostname) return;
    const current = await chrome.storage.sync.get({ blacklist: [], whitelist: [] });
    const bl = current.blacklist;
    const wl = current.whitelist;

    const idx = bl.indexOf(hostname);
    if (idx >= 0) {
      bl.splice(idx, 1);
      btnBlock.classList.remove('active-block');
      btnBlock.textContent = 'Blockieren';
    } else {
      bl.push(hostname);
      const wIdx = wl.indexOf(hostname);
      if (wIdx >= 0) { wl.splice(wIdx, 1); btnAllow.classList.remove('active-allow'); btnAllow.textContent = 'Erlauben'; }
      btnBlock.classList.add('active-block');
      btnBlock.textContent = 'Blockiert';
    }
    await chrome.storage.sync.set({ blacklist: bl, whitelist: wl });
  });

  btnAllow.addEventListener('click', async () => {
    if (!hostname) return;
    const current = await chrome.storage.sync.get({ blacklist: [], whitelist: [] });
    const wl = current.whitelist;
    const bl = current.blacklist;

    const idx = wl.indexOf(hostname);
    if (idx >= 0) {
      wl.splice(idx, 1);
      btnAllow.classList.remove('active-allow');
      btnAllow.textContent = 'Erlauben';
    } else {
      wl.push(hostname);
      const bIdx = bl.indexOf(hostname);
      if (bIdx >= 0) { bl.splice(bIdx, 1); btnBlock.classList.remove('active-block'); btnBlock.textContent = 'Blockieren'; }
      btnAllow.classList.add('active-allow');
      btnAllow.textContent = 'Erlaubt';
    }
    await chrome.storage.sync.set({ whitelist: wl, blacklist: bl });
  });

  // ─── Selection-based report ───────────────────────────────────────────────

  btnFromSelection.addEventListener('click', async () => {
    if (!currentTab || !currentTab.id) return;

    chrome.tabs.sendMessage(currentTab.id, { type: 'getSelection' }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      if (response.text) {
        reportWord.value = response.text;
        reportHint.textContent = response.context
          ? `Kontext: „…${response.context}…"`
          : '';
      } else {
        reportHint.textContent = 'Kein Text auf der Seite markiert.';
      }
    });
  });

  btnReport.addEventListener('click', async () => {
    const word = reportWord.value.trim();
    if (!word) return;

    const url = currentTab?.url || '';
    const context = reportHint.textContent.startsWith('Kontext:')
      ? reportHint.textContent.replace('Kontext: „…', '').replace('…"', '')
      : '';

    const data = await chrome.storage.local.get({ reportedWords: [] });
    data.reportedWords.push({
      word,
      url,
      context,
      timestamp: new Date().toISOString(),
    });
    await chrome.storage.local.set({ reportedWords: data.reportedWords });

    reportWord.value = '';
    reportHint.textContent = 'Tipp: Text auf der Seite markieren, dann „Auswahl" klicken';
    reportSuccess.style.display = 'block';
    setTimeout(() => { reportSuccess.style.display = 'none'; }, 2000);
  });

  // ─── Options ──────────────────────────────────────────────────────────────

  openOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
