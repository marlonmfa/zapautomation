/**
 * Local HTTP server that displays the WhatsApp pairing QR code in a browser.
 * Uses Server-Sent Events to push QR image updates and auth status.
 */
const http = require('http');
const { exec } = require('child_process');

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`, () => {});
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp Sync – Scan QR Code</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: linear-gradient(160deg, #0d1117 0%, #161b22 100%);
      color: #e6edf3;
      padding: 1.5rem;
      text-align: center;
    }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
    .sub { color: #8b949e; font-size: 0.9rem; margin-bottom: 1.5rem; }
    #qr-container {
      background: #fff;
      padding: 1.5rem;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      margin-bottom: 1.5rem;
    }
    #qr-container img { display: block; }
    #status { min-height: 1.5em; font-size: 0.95rem; }
    #status.success { color: #3fb950; }
    #status.error { color: #f85149; }
    .loading { color: #8b949e; }
  </style>
</head>
<body>
  <h1>WhatsApp Sync</h1>
  <p class="sub">Link this device with your phone</p>
  <div id="qr-container">
    <div id="status" class="loading">Waiting for QR code…</div>
    <div id="qr-img" style="display: none;"></div>
  </div>
  <p class="sub">Open WhatsApp on your phone → Linked Devices → Link a device → Scan this QR code</p>
  <script>
    const statusEl = document.getElementById('status');
    const qrImgEl = document.getElementById('qr-img');
    const evtSource = new EventSource('/events');
    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'qr') {
        statusEl.textContent = 'Scan the QR code with WhatsApp';
        statusEl.className = '';
        qrImgEl.style.display = 'block';
        qrImgEl.innerHTML = '<img src="' + data.dataUrl + '" alt="QR Code" width="264" height="264" />';
      } else if (data.type === 'authenticated') {
        statusEl.textContent = 'Authenticated. Saving session…';
        statusEl.className = 'success';
        qrImgEl.style.display = 'none';
      } else if (data.type === 'ready') {
        statusEl.textContent = 'Done! You can close this tab.';
        statusEl.className = 'success';
        qrImgEl.style.display = 'none';
      }
    };
    evtSource.onerror = () => { evtSource.close(); };
  </script>
</body>
</html>
`;

/**
 * Create and start a QR server. Call setQR(dataUrl) when you have a QR, setAuthenticated() / setReady() when done.
 * @param {object} [options] - { port: number, open: (url: string) => void }
 * @returns {Promise<{{ setQR: (dataUrl: string) => void, setAuthenticated: () => void, setReady: () => void, getPort: () => number, close: () => void }}>}
 */
function createQRServer(options = {}) {
  const port = options.port || 0;
  const open = options.open || openBrowser;
  const openOnStart = options.openOnStart === true;
  let sseClients = [];
  let browserOpened = false;
  let lastQRDataUrl = null;

  const server = http.createServer((req, res) => {
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML_PAGE);
      return;
    }
    if (req.url === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      sseClients.push(res);
      if (lastQRDataUrl) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'qr', dataUrl: lastQRDataUrl })}\n\n`);
        } catch (_) {}
      }
      req.on('close', () => {
        sseClients = sseClients.filter((c) => c !== res);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  function broadcast(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach((res) => {
      try {
        res.write(msg);
      } catch (_) {}
    });
  }

  function setQR(dataUrl) {
    lastQRDataUrl = dataUrl;
    if (!browserOpened) {
      browserOpened = true;
      const url = `http://127.0.0.1:${server.address().port}`;
      open(url);
    }
    broadcast({ type: 'qr', dataUrl });
  }

  function setAuthenticated() {
    broadcast({ type: 'authenticated' });
  }

  function setReady() {
    broadcast({ type: 'ready' });
  }

  function getPort() {
    return server.address() ? server.address().port : null;
  }

  function close() {
    sseClients.forEach((res) => {
      try {
        res.end();
      } catch (_) {}
    });
    sseClients = [];
    server.close();
  }

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      if (openOnStart) {
        const url = `http://127.0.0.1:${server.address().port}`;
        open(url);
        browserOpened = true;
      }
      resolve({
        setQR,
        setAuthenticated,
        setReady,
        getPort,
        close,
      });
    });
    server.on('error', reject);
  });
}

module.exports = { createQRServer, getQRServerHTML: () => HTML_PAGE };
