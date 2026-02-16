/**
 * Kill Chrome/Chromium that usa a sessão do WhatsApp.
 * --force: fecha TODAS as janelas do Google Chrome (uso: node kill-wa-browser.js --force)
 *
 * Usage: node src/scripts/kill-wa-browser.js [--force]
 */

const path = require('path');
const { execSync } = require('child_process');

const forceAll = process.argv.includes('--force') || process.env.KILL_WA_FORCE === '1';
const authPath = path.resolve(process.cwd(), process.env.AUTH_DATA_PATH || '.wwebjs_auth');
const searchPath = path.basename(authPath);

function killWindows() {
  if (forceAll) {
    try {
      execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore', windowsHide: true });
    } catch (_) {}
    try {
      execSync('taskkill /F /IM chromium.exe 2>nul', { stdio: 'ignore', windowsHide: true });
    } catch (_) {}
    return true;
  }
  const needle = 'wwebjs_auth';
  try {
    const list = execSync('wmic process where "name=\'chrome.exe\' or name=\'chromium.exe\'" get ProcessId,CommandLine 2>nul', { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    const lines = list.split(/\r?\n/).filter(Boolean);
    let inHeader = true;
    for (const line of lines) {
      if (inHeader && (line.includes('CommandLine') || line.includes('ProcessId'))) continue;
      inHeader = false;
      if (line.toLowerCase().includes(needle)) {
        const pids = line.match(/\d+/g);
        if (pids) {
          const pid = pids[pids.length - 1];
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  try {
    const ps = `Get-CimInstance Win32_Process -Filter "name='chrome.exe' OR name='chromium.exe'" 2>$null | Where-Object { $_.CommandLine -and $_.CommandLine -like '*${needle}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '""')}"`, { stdio: 'ignore', windowsHide: true, timeout: 15000 });
  } catch (_) {}
  return true;
}

function killDarwin() {
  try {
    if (forceAll) execSync('pkill -9 -f "Google Chrome" || pkill -9 -f Chromium || true', { stdio: 'ignore' });
    else execSync(`pkill -f "Chrome.*${searchPath}" || true`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function killLinux() {
  try {
    if (forceAll) execSync('pkill -9 -f chrome || pkill -9 -f chromium || true', { stdio: 'ignore' });
    else execSync(`pkill -f "chrome.*${searchPath}" || pkill -f "chromium.*${searchPath}" || true`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const platform = process.platform;
  if (platform === 'win32') killWindows();
  else if (platform === 'darwin') killDarwin();
  else killLinux();
}

main();
