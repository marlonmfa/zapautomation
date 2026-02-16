/**
 * Standalone HTTP server that serves a webpage with wa.me links from a batch JSON file.
 * No WhatsApp client; user opens each link and sends the message manually from their device.
 * Usage: node src/scripts/serve-wa-links.js [path-to-batch.json]
 * Or set BATCH_FILE and run the script; port via LINKS_SERVER_PORT (default 3456).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 3456;

function normalizePhone(contact) {
  if (typeof contact !== 'string') return '';
  return contact.replace(/\D/g, '');
}

function buildWaMeUrl(contact, message) {
  const digits = normalizePhone(contact);
  if (!digits) return null;
  const text = typeof message === 'string' ? message : '';
  const params = new URLSearchParams();
  if (text) params.set('text', text);
  const query = params.toString();
  return `https://wa.me/${digits}${query ? '?' + query : ''}`;
}

function loadBatch(batchPath) {
  const absolutePath = path.isAbsolute(batchPath) ? batchPath : path.join(process.cwd(), batchPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Batch file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const items = JSON.parse(raw);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Batch file must be a non-empty array of { contact, message }.');
  }
  return items;
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage(items) {
  const links = items
    .map((item, index) => {
      const url = buildWaMeUrl(item.contact, item.message);
      if (!url) return null;
      const number = escapeHtml(item.contact);
      const message = escapeHtml(typeof item.message === 'string' ? item.message : '');
      return `
    <li class="link-item">
      <div class="link-card">
        <div class="link-header">
          <span class="link-num">#${index + 1}</span>
          <span class="link-contact">${number}</span>
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="wa-link-btn">Open in WhatsApp</a>
        </div>
        <div class="link-message">${message.replace(/\n/g, '<br>')}</div>
      </div>
    </li>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp links – ${items.length} contacts</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 720px;
      margin: 0 auto;
      padding: 1.5rem;
      background: #0b141a;
      color: #e9edef;
      min-height: 100vh;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .sub {
      color: #8696a0;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .link-item {
      margin-bottom: 1rem;
    }
    .link-card {
      padding: 1rem 1.25rem;
      background: #1f2c34;
      border-radius: 8px;
      border: 1px solid #2a3942;
    }
    .link-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      margin-bottom: 0.75rem;
    }
    .link-num {
      font-weight: 600;
      color: #8696a0;
      min-width: 2rem;
    }
    .link-contact {
      font-weight: 600;
      color: #e9edef;
      font-family: ui-monospace, monospace;
    }
    .wa-link-btn {
      margin-left: auto;
      padding: 0.4rem 0.75rem;
      background: #00a884;
      color: #fff;
      text-decoration: none;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 500;
      transition: background 0.15s, filter 0.15s;
    }
    .wa-link-btn:hover {
      background: #06cf9c;
      filter: brightness(1.05);
    }
    .link-message {
      font-size: 0.95rem;
      color: #8696a0;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      padding-left: 0.25rem;
      border-left: 2px solid #2a3942;
    }
  </style>
</head>
<body>
  <h1>WhatsApp links</h1>
  <p class="sub">${items.length} contact(s). Click a row to open WhatsApp with the number and message pre-filled; send with one tap.</p>
  <ul>${links}
  </ul>
</body>
</html>`;
}

function createWaLinksServer(batchPath, port = DEFAULT_PORT) {
  let items;
  try {
    items = loadBatch(batchPath);
  } catch (err) {
    throw err;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || (req.url !== '/' && req.url !== '')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const html = renderPage(items);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.listen(port, () => {
    const bound = server.address();
    const portDisplay = bound && bound.port ? bound.port : port;
    console.log(`WA links server: http://127.0.0.1:${portDisplay} (${items.length} links)`);
  });

  return server;
}

module.exports = {
  createWaLinksServer,
  loadBatch,
  buildWaMeUrl,
  normalizePhone,
  renderPage,
  escapeHtml,
  DEFAULT_PORT,
};
