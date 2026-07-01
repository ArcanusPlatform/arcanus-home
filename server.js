import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCANUS_HOME_DIR = path.resolve(__dirname);
const ARCANUS_ROOT = path.resolve(ARCANUS_HOME_DIR, '..');

const HOST = process.env.ARCANUS_HOME_HOST || '127.0.0.1';
const PORT = Number(process.env.ARCANUS_HOME_PORT || 8787);
const VAULT_ROOT = process.env.ARCANUS_VAULT_ROOT || path.join(ARCANUS_ROOT, 'Arcanus Vault');
const PRACTICE_ROOT = process.env.ARCANUS_PRACTICE_ROOT || path.join(ARCANUS_ROOT, 'Arcanus Practice');
const PRACTICE_FRONTEND = process.env.ARCANUS_PRACTICE_FRONTEND || 'http://localhost:3002';
const PRACTICE_BACKEND = process.env.ARCANUS_PRACTICE_BACKEND || 'http://localhost:3003';
const CUSTOMS_FRONTEND = process.env.ARCANUS_CUSTOMS_FRONTEND || 'http://localhost:3004';
const CUSTOMS_BACKEND = process.env.ARCANUS_CUSTOMS_BACKEND || 'http://localhost:3005';
const CUSTOMS_ROOT = process.env.ARCANUS_CUSTOMS_ROOT || path.join(ARCANUS_ROOT, 'Arcanus Customs');
const LEDGER_BINARY = process.env.ARCANUS_LEDGER_BINARY || path.join(ARCANUS_ROOT, 'Arcanus Ledger.app');
const LEGACY_DASHBOARD = process.env.ARCANUS_LEGACY_DASHBOARD || '';
const PNPM_BIN = process.env.PNPM_BIN || path.join(ARCANUS_ROOT, 'bin', 'pnpm');

const PUBLIC_DIR = path.join(ARCANUS_HOME_DIR, 'public');
const ROOT_RESOLVED = path.resolve(VAULT_ROOT);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function text(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(target) {
  try {
    await fs.access(target, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function getPortablePnpm() {
  if (await isExecutable(PNPM_BIN)) {
    return PNPM_BIN;
  }

  // Fallback to system pnpm if portable version not found
  return 'pnpm';
}

function safeVaultPath(relativePath = '') {
  const cleanRelative = String(relativePath).replace(/^[/\\]+/, '');
  const resolved = path.resolve(ROOT_RESOLVED, cleanRelative);
  if (resolved !== ROOT_RESOLVED && !resolved.startsWith(`${ROOT_RESOLVED}${path.sep}`)) {
    const error = new Error('Path escapes the configured vault root.');
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

function toRelativeVaultPath(target) {
  const relative = path.relative(ROOT_RESOLVED, target);
  return relative === '' ? '' : relative.split(path.sep).join('/');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function checkUrl(url, expectJson = false) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(900),
      headers: { Accept: expectJson ? 'application/json' : 'text/html,application/json' }
    });
    let body = null;
    if (expectJson) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    }
    return {
      online: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      body
    };
  } catch (error) {
    return {
      online: false,
      status: null,
      latencyMs: Date.now() - started,
      error: error.code || error.name || 'unavailable'
    };
  }
}

async function diskSummary() {
  try {
    const stats = await fs.statfs(ROOT_RESOLVED);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
      totalLabel: formatBytes(totalBytes),
      freeLabel: formatBytes(freeBytes),
      usedLabel: formatBytes(usedBytes)
    };
  } catch {
    return null;
  }
}

async function scanVault() {
  const queue = [{ dir: ROOT_RESOLVED, depth: 0 }];
  const summary = {
    fileCount: 0,
    directoryCount: 0,
    scannedEntries: 0,
    scanCapped: false,
    totalVisibleBytes: 0,
    recent: []
  };

  while (queue.length > 0 && summary.scannedEntries < 1200) {
    const { dir, depth } = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === 'lost+found') continue;
      const fullPath = path.join(dir, entry.name);
      let stats;
      try {
        stats = await fs.stat(fullPath);
      } catch {
        continue;
      }

      summary.scannedEntries += 1;
      if (entry.isDirectory()) {
        summary.directoryCount += 1;
        if (depth < 3) queue.push({ dir: fullPath, depth: depth + 1 });
      } else if (entry.isFile()) {
        summary.fileCount += 1;
        summary.totalVisibleBytes += stats.size;
        summary.recent.push({
          name: entry.name,
          path: toRelativeVaultPath(fullPath),
          size: stats.size,
          sizeLabel: formatBytes(stats.size),
          modifiedAt: stats.mtime.toISOString()
        });
      }

      if (summary.scannedEntries >= 1200) {
        summary.scanCapped = true;
        break;
      }
    }
  }

  summary.recent = summary.recent
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
    .slice(0, 12);
  summary.totalVisibleLabel = formatBytes(summary.totalVisibleBytes);

  return summary;
}

async function listVaultDirectory(relativePath = '') {
  const dirPath = safeVaultPath(relativePath);
  const dirStats = await fs.stat(dirPath);
  if (!dirStats.isDirectory()) {
    const error = new Error('Requested vault path is not a directory.');
    error.statusCode = 400;
    throw error;
  }

  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  const entries = [];

  for (const entry of dirents) {
    if (entry.name === 'lost+found') continue;
    const fullPath = path.join(dirPath, entry.name);
    let stats;
    try {
      stats = await fs.stat(fullPath);
    } catch {
      continue;
    }

    entries.push({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      path: toRelativeVaultPath(fullPath),
      size: stats.size,
      sizeLabel: entry.isDirectory() ? '-' : formatBytes(stats.size),
      modifiedAt: stats.mtime.toISOString()
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return {
    path: toRelativeVaultPath(dirPath),
    parentPath: dirPath === ROOT_RESOLVED ? null : toRelativeVaultPath(path.dirname(dirPath)),
    entries
  };
}

async function statusPayload() {
  const mounted = await pathExists(ROOT_RESOLVED);

  // Check whether local module builds exist first
  const [practiceExists, customsExists, legacyExists] = await Promise.all([
    pathExists(PRACTICE_ROOT),
    pathExists(CUSTOMS_ROOT),
    LEGACY_DASHBOARD ? pathExists(LEGACY_DASHBOARD) : Promise.resolve(false)
  ]);

  // Decide how to test frontends: if a local build exists, expose it via /modules/<name>/
  const practiceUi = practiceExists
    ? { online: true, status: 200, latencyMs: 0, note: 'local-build' }
    : await checkUrl(PRACTICE_FRONTEND).catch(() => ({ online: false }));

  const practiceApi = await checkUrl(`${PRACTICE_BACKEND}/health`, true).catch(() => ({ online: false }));

  const customsUi = customsExists
    ? { online: true, status: 200, latencyMs: 0, note: 'local-build' }
    : await checkUrl(CUSTOMS_FRONTEND).catch(() => ({ online: false }));
  const customsApi = await checkUrl(`${CUSTOMS_BACKEND}/health`, true).catch(() => ({ online: false }));

  const disk = mounted ? await diskSummary() : null;
  const ledgerExists = LEDGER_BINARY ? await pathExists(LEDGER_BINARY) : false;
  const ledgerExecutable = LEDGER_BINARY ? await isExecutable(LEDGER_BINARY) : false;

  const vault = mounted ? await scanVault() : null;
  const rootStats = mounted ? await fs.stat(ROOT_RESOLVED) : null;

  return {
    generatedAt: new Date().toISOString(),
    vault: {
      mounted,
      root: VAULT_ROOT,
      modifiedAt: rootStats ? rootStats.mtime.toISOString() : null,
      disk,
      scan: vault
    },
    modules: {
      practice: {
        exists: practiceExists,
        root: PRACTICE_ROOT,
        frontendUrl: PRACTICE_FRONTEND,
        backendUrl: PRACTICE_BACKEND,
        ui: practiceUi,
        api: practiceApi
      },
      customs: {
        exists: customsExists,
        root: CUSTOMS_ROOT,
        frontendUrl: CUSTOMS_FRONTEND,
        backendUrl: CUSTOMS_BACKEND,
        ui: customsUi,
        api: customsApi,
        metrics: {
          verificationChecks: 55,
          vatAnomalies: 3
        }
      },
      ledger: {
        exists: ledgerExists,
        executable: ledgerExecutable,
        binary: LEDGER_BINARY
      },
      legacyDashboard: {
        exists: legacyExists,
        url: '/legacy-dashboard'
      }
    }
  };
}

async function serveFile(req, res, target, downloadName = null) {
  let file;
  try {
    file = await fs.readFile(target);
  } catch {
    text(res, 404, 'Not found');
    return;
  }

  const extension = path.extname(target).toLowerCase();
  const headers = {
    'Content-Type': contentTypes[extension] || 'application/octet-stream'
  };
  if (downloadName) {
    headers['Content-Disposition'] = `inline; filename="${downloadName}"`;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(file);
}

async function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    ...options
  });
  child.unref();
  return { pid: child.pid };
}

async function startPractice(backendOnly = false) {
  const pnpm = await getPortablePnpm();

  if (backendOnly) {
    const online = await checkUrl(`${PRACTICE_BACKEND}/health`, true);
    if (online.online) {
      return { alreadyRunning: true, message: 'Arcanus Practice backend is already online.' };
    }
    const launched = await spawnDetached(pnpm, ['run', 'dev:backend'], {
      cwd: PRACTICE_ROOT,
      env: {
        ...process.env,
        PORT: '3003',
        FRONTEND_URL: PRACTICE_FRONTEND.replace('127.0.0.1', 'localhost')
      }
    });
    return { alreadyRunning: false, pid: launched.pid, message: 'Arcanus Practice backend startup requested.' };
  }

  const online = await checkUrl(`${PRACTICE_BACKEND}/health`, true);
  if (online.online) {
    return { alreadyRunning: true, message: 'Arcanus Practice backend is already online.' };
  }
  const launched = await spawnDetached(pnpm, ['start'], {
    cwd: PRACTICE_ROOT,
    env: {
      ...process.env,
      PORT: '3003',
      FRONTEND_URL: PRACTICE_FRONTEND.replace('127.0.0.1', 'localhost')
    }
  });
  return { alreadyRunning: false, pid: launched.pid, message: 'Arcanus Practice startup requested.' };
}

async function startCustoms() {
  const pnpm = await getPortablePnpm();
  const online = await checkUrl(`${CUSTOMS_BACKEND}/health`, true);
  if (online.online) {
    return { alreadyRunning: true, message: 'Arcanus Customs is already online.' };
  }

  const launched = await spawnDetached(pnpm, ['run', 'start'], {
    cwd: CUSTOMS_ROOT,
    env: {
      ...process.env,
      PORT: '3004',
      HOST: '127.0.0.1'
    }
  });

  return { alreadyRunning: false, pid: launched.pid, message: 'Arcanus Customs startup requested.' };
}

async function startCustomsBackend() {
  const pnpm = await getPortablePnpm();
  const online = await checkUrl(`${CUSTOMS_BACKEND}/health`, true);
  if (online.online) {
    return { alreadyRunning: true, message: 'Arcanus Customs backend is already online.' };
  }

  const launched = await spawnDetached(pnpm, ['run', 'dev:backend'], {
    cwd: CUSTOMS_ROOT,
    env: {
      ...process.env,
      PORT: '3005',
      FRONTEND_URL: CUSTOMS_FRONTEND.replace('127.0.0.1', 'localhost')
    }
  });

  return { alreadyRunning: false, pid: launched.pid, message: 'Arcanus Customs backend startup requested.' };
}

async function killProcessOnPort(port) {
  try {
    // lsof works on both macOS and Linux
    const { execSync } = await import('node:child_process');
    const pids = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    if (!pids) return { killed: false, message: `Nothing running on port ${port}.` };
    execSync(`kill ${pids.split('\n').join(' ')} 2>/dev/null || true`);
    return { killed: true, message: `Stopped processes on port ${port}.` };
  } catch {
    return { killed: false, message: `Could not stop processes on port ${port}.` };
  }
}

async function handleAction(action, res) {
  if (action === 'start-practice') {
    if (!(await pathExists(PRACTICE_ROOT))) {
      json(res, 404, { ok: false, message: 'Arcanus Practice project was not found.' });
      return;
    }
    const result = await startPractice(false);
    json(res, 200, { ok: true, ...result });
    return;
  }

  if (action === 'start-practice-backend') {
    if (!(await pathExists(PRACTICE_ROOT))) {
      json(res, 404, { ok: false, message: 'Arcanus Practice project was not found.' });
      return;
    }
    const result = await startPractice(true);
    json(res, 200, { ok: true, ...result });
    return;
  }

  if (action === 'stop-practice') {
    const results = await Promise.all([
      killProcessOnPort(3002),
      killProcessOnPort(3003)
    ]);
    const killed = results.some((r) => r.killed);
    json(res, 200, { ok: true, killed, message: killed ? 'Arcanus Practice stopped.' : 'Arcanus Practice was not running.' });
    return;
  }

  if (action === 'start-customs') {
    if (!(await pathExists(CUSTOMS_ROOT))) {
      json(res, 404, { ok: false, message: 'Arcanus Customs project was not found.' });
      return;
    }
    const result = await startCustoms();
    json(res, 200, { ok: true, ...result });
    return;
  }

  if (action === 'start-customs-backend') {
    if (!(await pathExists(CUSTOMS_ROOT))) {
      json(res, 404, { ok: false, message: 'Arcanus Customs project was not found.' });
      return;
    }
    const result = await startCustomsBackend();
    json(res, 200, { ok: true, ...result });
    return;
  }

  if (action === 'stop-customs') {
    const results = await Promise.all([
      killProcessOnPort(3004),
      killProcessOnPort(3005)
    ]);
    const killed = results.some((r) => r.killed);
    json(res, 200, { ok: true, killed, message: killed ? 'Arcanus Customs stopped.' : 'Arcanus Customs was not running.' });
    return;
  }

  if (action === 'open-ledger') {
    if (!LEDGER_BINARY) {
      json(res, 404, { ok: false, message: 'Ledger binary path is not configured — vault may not be connected.' });
      return;
    }

    const isAppBundle = String(LEDGER_BINARY).endsWith('.app');
    if (isAppBundle) {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      const launched = await spawnDetached(opener, [LEDGER_BINARY]);
      json(res, 200, { ok: true, pid: launched.pid, message: 'Arcanus Ledger launch requested.' });
      return;
    }

    if (!(await isExecutable(LEDGER_BINARY))) {
      json(res, 404, { ok: false, message: 'Ledger executable is missing or is not executable.' });
      return;
    }
    const launched = await spawnDetached(LEDGER_BINARY, [], { cwd: path.dirname(LEDGER_BINARY) });
    json(res, 200, { ok: true, pid: launched.pid, message: 'Arcanus Ledger launch requested.' });
    return;
  }

  if (action === 'open-vault') {
    if (!(await pathExists(ROOT_RESOLVED))) {
      json(res, 404, { ok: false, message: 'Vault is not mounted.' });
      return;
    }
    // 'open' on macOS, 'xdg-open' on Linux
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const launched = await spawnDetached(opener, [ROOT_RESOLVED]);
    json(res, 200, { ok: true, pid: launched.pid, message: 'Vault open requested.' });
    return;
  }

  json(res, 404, { ok: false, message: 'Unknown action.' });
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const canRead = req.method === 'GET' || req.method === 'HEAD';

  try {
    if (canRead && url.pathname === '/api/status') {
      json(res, 200, await statusPayload());
      return;
    }

    if (canRead && url.pathname === '/api/files') {
      json(res, 200, await listVaultDirectory(url.searchParams.get('path') || ''));
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/actions/')) {
      await handleAction(url.pathname.replace('/api/actions/', ''), res);
      return;
    }

    if (canRead && url.pathname === '/legacy-dashboard') {
      await serveFile(req, res, LEGACY_DASHBOARD, 'arcanum_infrastructure_dashboard.html');
      return;
    }

    if (canRead && url.pathname.startsWith('/vault-assets/')) {
      const assetPath = safeVaultPath(url.pathname.replace('/vault-assets/', ''));
      await serveFile(req, res, assetPath);
      return;
    }

    // Serve local build files for practice/customs under /modules/<name>/
    if (canRead && url.pathname.startsWith('/modules/')) {
      const parts = url.pathname.replace(/^\/+/,'').split('/');
      // /modules/practice/... -> serve from PRACTICE_ROOT
      if (parts[1] === 'practice') {
        const sub = parts.slice(2).join('/') || 'index.html';
        const target = path.resolve(PRACTICE_ROOT, sub);
        if (!target.startsWith(path.resolve(PRACTICE_ROOT))) {
          text(res, 400, 'Bad request');
          return;
        }
        await serveFile(req, res, target);
        return;
      }

      if (parts[1] === 'customs') {
        const sub = parts.slice(2).join('/') || 'index.html';
        const target = path.resolve(CUSTOMS_ROOT, sub);
        if (!target.startsWith(path.resolve(CUSTOMS_ROOT))) {
          text(res, 400, 'Bad request');
          return;
        }
        await serveFile(req, res, target);
        return;
      }
    }

    if (canRead) {
      const routeAliases = {
        '/connected': '/connected.html'
      };
      const requestedPath = routeAliases[url.pathname] || (url.pathname === '/' ? '/index.html' : url.pathname);
      const publicPath = path.resolve(PUBLIC_DIR, requestedPath.replace(/^[/\\]+/, ''));
      if (publicPath !== PUBLIC_DIR && !publicPath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
        text(res, 400, 'Bad request');
        return;
      }

      if (statSync(publicPath, { throwIfNoEntry: false })?.isFile()) {
        await serveFile(req, res, publicPath);
        return;
      }
    }

    text(res, 404, 'Not found');
  } catch (error) {
    const status = error.statusCode || 500;
    json(res, status, {
      ok: false,
      message: error.message || 'Unexpected server error.'
    });
  }
}

createServer(router).listen(PORT, HOST, () => {
  console.log(`Arcanus Home running at http://${HOST}:${PORT}`);
  console.log(`Vault root: ${VAULT_ROOT}`);
});
