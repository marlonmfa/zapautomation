/**
 * Create or restore a test session. On first run a browser window opens with the QR code;
 * auth is stored per SESSION_ID so the same user/phone does not need to scan again.
 * Usage: SESSION_ID=my-phone npm run session
 */
const QRCode = require('qrcode');
const { createClient } = require('../client');
const { createQRServer } = require('../qr-server');
const { getSessionClientId } = require('../config');

const QR_SERVER_PORT = 37829;

async function main() {
  const qrServer = await createQRServer({ port: QR_SERVER_PORT, openOnStart: true });
  const port = qrServer.getPort();
  console.log(`Session sync page: http://127.0.0.1:${port} (browser should open automatically)`);

  const client = createClient({
    headless: false,
    puppeteer: { headless: false },
  });

  const sessionId = getSessionClientId();
  console.log(`Session ID: ${sessionId}. Auth will be stored for this session.`);
  console.log('Connecting to WhatsApp...');

  client.on('qr', async (qr) => {
    console.log('No valid session found — please scan the QR code below.');
    const dataUrl = await QRCode.toDataURL(qr, { width: 264, margin: 2 });
    qrServer.setQR(dataUrl);
    const terminalQr = await QRCode.toString(qr, { type: 'terminal' });
    console.log('Scan the QR code with WhatsApp (Linked Devices):\n');
    console.log(terminalQr);
    console.log('\nOr scan from the browser window.');
  });

  client.on('authenticated', () => {
    qrServer.setAuthenticated();
    console.log('Authenticated. Session will be saved; next run with same SESSION_ID may not require QR.');
  });

  client.on('auth_failure', (msg) => {
    console.error('Auth failure:', msg);
    qrServer.close();
    process.exit(1);
  });

  client.on('ready', () => {
    qrServer.setReady();
    console.log('Client is ready. Session is stored. You can close this process and run again with same SESSION_ID.');
    if (client.info) {
      console.log('Logged in as:', client.info.pushname, client.info.wid?.user);
    }
    setTimeout(() => qrServer.close(), 3000);
  });

  client.on('disconnected', (reason) => {
    console.log('Disconnected:', reason);
  });

  try {
    await client.initialize();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error('Connection failed:', msg);
    if (msg.includes('Could not find Chrome') || msg.includes('Executable doesn\'t exist')) {
      console.error('\nTip: Install Chrome or set PUPPETEER_EXECUTABLE_PATH in .env to your Chrome path (e.g. /Applications/Google Chrome.app/Contents/MacOS/Google Chrome on macOS).');
    }
    if (msg.includes('already running') || msg.includes('Use a different')) {
      console.error('\nTip: Close any other WhatsApp Web window or linked device, then try again.');
    }
    qrServer.close();
    process.exit(1);
  }
}

main();
