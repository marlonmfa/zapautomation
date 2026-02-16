const { Client, LocalAuth } = require('whatsapp-web.js');
const { getAuthDataPath, getSessionClientId, getPuppeteerExecutablePath } = require('./config');

/**
 * Creates a WhatsApp client with persistent session.
 * Same SESSION_ID (e.g. same phone/user) reuses stored auth and does not require QR scan every time.
 * @param {object} [options] - Optional puppeteer/device options
 * @returns {Client}
 */
function createClient(options = {}) {
  const clientId = getSessionClientId();
  const dataPath = getAuthDataPath();
  const executablePath = getPuppeteerExecutablePath();

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId,
      dataPath,
    }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: options.headless !== false,
      ...(executablePath && { executablePath }),
      ...options.puppeteer,
    },
    ...options,
  });

  return client;
}

module.exports = { createClient };
