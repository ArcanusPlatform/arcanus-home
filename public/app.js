const state = {
  status: null,
  currentPath: '',
  parentPath: null,
  events: []
};

const els = {
  refreshButton: document.querySelector('#refreshButton'),
  sidebarVaultDot: document.querySelector('#sidebarVaultDot'),
  sidebarVaultTitle: document.querySelector('#sidebarVaultTitle'),
  sidebarVaultPath: document.querySelector('#sidebarVaultPath'),
  vaultState: document.querySelector('#vaultState'),
  // Module dots & meta
  practiceStatusDot: document.querySelector('#practiceStatusDot'),
  practiceMeta: document.querySelector('#practiceMeta'),
  practiceBar: document.querySelector('#practiceBar'),
  customsStatusDot: document.querySelector('#customsStatusDot'),
  customsMeta: document.querySelector('#customsMeta'),
  customsBar: document.querySelector('#customsBar'),
  ledgerStatusDot: document.querySelector('#ledgerStatusDot'),
  ledgerMeta: document.querySelector('#ledgerMeta'),
  ledgerBar: document.querySelector('#ledgerBar'),
  vaultModuleStatusDot: document.querySelector('#vaultModuleStatusDot'),
  vaultModuleMeta: document.querySelector('#vaultModuleMeta'),
  vaultBar: document.querySelector('#vaultBar'),
  // Metrics strip
  metricFiles: document.querySelector('#metricFiles'),
  metricDirs: document.querySelector('#metricDirs'),
  metricDisk: document.querySelector('#metricDisk'),
  metricScan: document.querySelector('#metricScan'),
  // File browser (connected.html only)
  fileTableBody: document.querySelector('#fileTableBody'),
  vaultPathTitle: document.querySelector('#vaultPathTitle'),
  upButton: document.querySelector('#upButton'),
  eventLog: document.querySelector('#eventLog'),
  toastRegion: document.querySelector('#toastRegion')
};

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function logEvent(message) {
  if (!els.eventLog) return;
  const timestamp = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date());
  state.events.unshift(`[${timestamp}] ${message}`);
  state.events = state.events.slice(0, 18);
  els.eventLog.innerHTML = state.events
    .map((event) => `<div class="event-entry">${escapeHtml(event)}</div>`)
    .join('');
}

function toast(message) {
  if (!els.toastRegion) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  els.toastRegion.appendChild(node);
  setTimeout(() => node.remove(), 5000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return entities[character];
  });
}

function setBar(el, state) {
  if (!el) return;
  el.className = el.className.replace(/\bis-\S+/g, '').trim();
  el.classList.add(state === 'online' ? 'is-online' : state === 'warn' ? 'is-warn' : 'is-offline');
}

function renderStatus(payload) {
  state.status = payload;
  const { vault, modules } = payload;
  const scan = vault.scan;

  // Vault pill in topbar
  if (els.sidebarVaultDot) els.sidebarVaultDot.className = `status-dot ${vault.mounted ? 'online' : 'offline'}`;
  if (els.sidebarVaultTitle) els.sidebarVaultTitle.textContent = vault.mounted ? 'Vault' : 'No vault';
  if (els.sidebarVaultPath) els.sidebarVaultPath.textContent = vault.root || '';

  // Vault metric in strip
  if (els.vaultState) {
    els.vaultState.textContent = vault.mounted ? 'Mounted' : 'Offline';
    els.vaultState.className = vault.mounted ? 'online-text' : 'offline-text';
  }

  // Practice tile
  const practiceOnline = modules.practice.api.online && modules.practice.ui.online;
  const practicePartial = !practiceOnline && modules.practice.api.online;
  const practiceState = practiceOnline ? 'online' : practicePartial ? 'warn' : 'offline';
  if (els.practiceStatusDot) els.practiceStatusDot.className = `status-dot ${practiceState}`;
  setBar(els.practiceBar, practiceState);
  if (els.practiceMeta) {
    els.practiceMeta.textContent = practiceOnline
      ? `API: ${modules.practice.api.latencyMs}ms · UI: ${modules.practice.ui.latencyMs}ms`
      : practicePartial
        ? 'UI offline — API responding'
        : 'Services offline';
  }

  // Customs tile
  const customsOnline = modules.customs?.ui?.online && modules.customs?.api?.online;
  const customsPartial = !customsOnline && modules.customs?.api?.online;
  const customsState = customsOnline ? 'online' : customsPartial ? 'warn' : 'offline';
  if (els.customsStatusDot) els.customsStatusDot.className = `status-dot ${customsState}`;
  setBar(els.customsBar, customsState);
  if (els.customsMeta) {
    if (customsOnline) {
      const { verificationChecks = 0, vatAnomalies = 0 } = modules.customs.metrics ?? {};
      els.customsMeta.textContent = `API: ${modules.customs.api.latencyMs}ms · UI: ${modules.customs.ui.latencyMs}ms · Checks: ${verificationChecks} · VAT flags: ${vatAnomalies}`;
    } else if (customsPartial) {
      els.customsMeta.textContent = 'UI offline — API responding';
    } else {
      els.customsMeta.textContent = 'Services offline';
    }
  }

  // Ledger tile
  const ledgerReady = modules.ledger.executable;
  const ledgerState = ledgerReady ? 'online' : modules.ledger.exists ? 'warn' : 'offline';
  if (els.ledgerStatusDot) els.ledgerStatusDot.className = `status-dot ${ledgerState}`;
  setBar(els.ledgerBar, ledgerState);
  if (els.ledgerMeta) {
    els.ledgerMeta.textContent = ledgerReady
      ? `Binary: ${modules.ledger.binary.split('/').pop()}`
      : modules.ledger.exists
        ? 'Found — not executable'
        : 'Not available — connect vault';
  }

  // Vault tile
  const vaultState2 = vault.mounted ? 'online' : 'offline';
  if (els.vaultModuleStatusDot) els.vaultModuleStatusDot.className = `status-dot ${vaultState2}`;
  setBar(els.vaultBar, vaultState2);
  if (els.vaultModuleMeta) {
    els.vaultModuleMeta.textContent = vault.mounted
      ? vault.disk
        ? `${vault.disk.usedLabel} used of ${vault.disk.totalLabel} (${vault.disk.usedPercent}%)`
        : 'Mounted — no disk metrics'
      : 'Drive not connected';
  }

  // Metrics strip
  if (els.metricFiles) els.metricFiles.textContent = scan ? scan.fileCount.toLocaleString('en-GB') : '—';
  if (els.metricDirs)  els.metricDirs.textContent  = scan ? scan.directoryCount.toLocaleString('en-GB') : '—';
  if (els.metricDisk)  els.metricDisk.textContent  = vault.disk ? `${vault.disk.usedPercent}%` : '—';
  if (els.metricScan)  els.metricScan.textContent  = formatDate(payload.generatedAt);

  // Update module links to reflect configured URLs from the server
  try {
    const practiceUiEl = document.getElementById('practiceOpenUi');
    const practiceDocsEl = document.getElementById('practiceDocs');
    const customsUiEl = document.getElementById('customsOpenUi');
    if (practiceUiEl && modules.practice?.frontendUrl) practiceUiEl.href = modules.practice.frontendUrl;
    if (practiceDocsEl && modules.practice?.backendUrl) practiceDocsEl.href = modules.practice.backendUrl.replace(/\/$/, '') + '/api-docs';
    if (customsUiEl && modules.customs?.frontendUrl) customsUiEl.href = modules.customs.frontendUrl;
  } catch (e) {
    // ignore DOM update errors
  }

  logEvent(`Status refreshed · vault ${vault.mounted ? 'mounted' : 'offline'} · Practice ${modules.practice.api.online ? 'online' : 'offline'}`);
}

async function refreshStatus() {
  if (els.refreshButton) els.refreshButton.disabled = true;
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Status request failed with ${response.status}`);
    const payload = await response.json();
    renderStatus(payload);
  } catch (error) {
    toast(error.message);
    logEvent(`Status error: ${error.message}`);
  } finally {
    if (els.refreshButton) els.refreshButton.disabled = false;
  }
}

async function loadFiles(relativePath = '') {
  if (!els.fileTableBody) return;
  state.currentPath = relativePath;
  els.fileTableBody.innerHTML = '<tr><td colspan="4">Loading vault entries...</td></tr>';

  try {
    const response = await fetch(`/api/files?path=${encodeURIComponent(relativePath)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `File request failed with ${response.status}`);

    state.parentPath = payload.parentPath;
    if (els.vaultPathTitle) els.vaultPathTitle.textContent = payload.path ? `Vault: ${payload.path}` : 'Vault root';
    if (els.upButton) els.upButton.disabled = payload.parentPath === null;

    if (payload.entries.length === 0) {
      els.fileTableBody.innerHTML = '<tr><td colspan="4">No readable entries.</td></tr>';
      return;
    }

    els.fileTableBody.innerHTML = payload.entries.map((entry) => {
      const name = entry.type === 'directory'
        ? `<button class="file-name-button" type="button" data-path="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</button>`
        : escapeHtml(entry.name);
      return `
        <tr>
          <td>${name}</td>
          <td>${entry.type}</td>
          <td>${entry.sizeLabel}</td>
          <td>${formatDate(entry.modifiedAt)}</td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    els.fileTableBody.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    logEvent(`Vault browser error: ${error.message}`);
  }
}

async function runAction(action) {
  try {
    const response = await fetch(`/api/actions/${action}`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || `Action failed: ${action}`);
    toast(payload.message || 'Action requested.');
    logEvent(payload.message || `Action requested: ${action}`);
    setTimeout(refreshStatus, 1400);
  } catch (error) {
    toast(error.message);
    logEvent(`Action error: ${error.message}`);
  }
}

document.addEventListener('click', (event) => {
  const fileButton = event.target.closest('[data-path]');
  if (fileButton) {
    loadFiles(fileButton.dataset.path);
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    runAction(actionButton.dataset.action);
  }
});

if (els.refreshButton) {
  els.refreshButton.addEventListener('click', () => {
    refreshStatus();
    loadFiles(state.currentPath);
  });
}

if (els.upButton) {
  els.upButton.addEventListener('click', () => {
    if (state.parentPath !== null) loadFiles(state.parentPath);
  });
}

document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((node) => node.classList.remove('active'));
    link.classList.add('active');
  });
});

logEvent('Arcanus Home booted.');
refreshStatus();
if (els.fileTableBody) loadFiles();
setInterval(refreshStatus, 30000);
