/**
 * Start the WA links server: serves a page with wa.me links from a batch JSON file.
 * Usage: node src/scripts/serve-wa-links.js [path-to-batch.json]
 * Env: BATCH_FILE (path to batch JSON), LINKS_SERVER_PORT (default 3456).
 */
require('dotenv').config();
const path = require('path');
const { createWaLinksServer, DEFAULT_PORT } = require('../wa-links-server');

const batchPath = process.env.BATCH_FILE || process.argv[2];
if (!batchPath) {
  console.error('Usage: node src/scripts/serve-wa-links.js <path-to-batch.json>');
  console.error('Or set BATCH_FILE in .env');
  process.exit(1);
}

const port = parseInt(process.env.LINKS_SERVER_PORT || String(DEFAULT_PORT), 10);
const resolvedPath = path.isAbsolute(batchPath) ? batchPath : path.join(process.cwd(), batchPath);

try {
  createWaLinksServer(resolvedPath, port);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
