/**
 * Diagnose WhatsApp connection: tries to connect and reports success, QR needed, or failure.
 * Run from project root: node src/scripts/check-connection.js
 * Helps identify why "WhatsApp is not connecting" (Chrome missing, no session, auth failure, etc.).
 */
const path = require('path');
const fs = require('fs');
const { createClient } = require('../client');
const { getSessionClientId, getAuthDataPath, getPuppeteerExecutablePath } = require('../config');

const CONNECTION_TIMEOUT_MS = 45000;

function main() {
  const sessionId = getSessionClientId();
  const authPath = getAuthDataPath();
  const authAbsolute = path.isAbsolute(authPath) ? authPath : path.join(process.cwd(), authPath);
  const chromePath = getPuppeteerExecutablePath();

  console.log('Session ID:', sessionId);
  console.log('Auth path:', authAbsolute);
  console.log('Chrome path:', chromePath || '(auto-detect)');
  if (!fs.existsSync(authAbsolute)) {
    console.log('(No session folder yet — you will need to scan QR on first connect.)');
  }
  console.log('');

  const client = createClient({ headless: true });
  let settled = false;

  function exit(code, message) {
    if (settled) return;
    settled = true;
    if (message) console.log(message);
    client.destroy().catch(() => {}).finally(() => process.exit(code));
  }

  const timeoutId = setTimeout(() => {
    exit(1, 'Connection timeout. Possible causes: no internet, WhatsApp down, or session expired (run "npm run session" to scan QR again).');
  }, CONNECTION_TIMEOUT_MS);

  client.on('ready', () => {
    clearTimeout(timeoutId);
    if (client.info) {
      console.log('Connection OK. Logged in as:', client.info.pushname, client.info.wid?.user);
    } else {
      console.log('Connection OK.');
    }
    exit(0);
  });

  client.on('qr', () => {
    console.log('QR code received — no valid session. Run "npm run session" to scan and save the session.');
  });

  client.on('authenticated', () => {
    console.log('Authenticated. Waiting for ready...');
  });

  client.on('auth_failure', (msg) => {
    clearTimeout(timeoutId);
    console.error('Auth failure:', msg);
    exit(1);
  });

  client.on('disconnected', (reason) => {
    if (!settled) console.log('Disconnected:', reason);
  });

  console.log('Connecting...');
  client.initialize().catch((err) => {
    clearTimeout(timeoutId);
    const msg = err && err.message ? err.message : String(err);
    console.error('Connection failed:', msg);
    if (msg.includes('Could not find Chrome') || msg.includes('Executable doesn\'t exist')) {
      console.error('Tip: Set PUPPETEER_EXECUTABLE_PATH in .env to your Chrome path.');
    }
    if (msg.includes('already running') || msg.includes('Use a different')) {
      console.error('Tip: Close any other WhatsApp Web window and try again.');
    }
    exit(1);
  });
}

main();
