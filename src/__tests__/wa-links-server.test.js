const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildWaMeUrl,
  normalizePhone,
  loadBatch,
  renderPage,
  escapeHtml,
  createWaLinksServer,
  DEFAULT_PORT,
} = require('../wa-links-server');

describe('wa-links-server', () => {
  describe('normalizePhone', () => {
    it('strips non-digits', () => {
      expect(normalizePhone('5547991416694')).toBe('5547991416694');
      expect(normalizePhone('+55 47 99141-6694')).toBe('5547991416694');
      expect(normalizePhone('+55 (47) 99141-6694')).toBe('5547991416694');
    });
    it('returns empty string for non-string', () => {
      expect(normalizePhone(null)).toBe('');
      expect(normalizePhone(123)).toBe('');
    });
  });

  describe('buildWaMeUrl', () => {
    it('builds wa.me URL with number and encoded text', () => {
      const url = buildWaMeUrl('5547991416694', 'Hello world');
      expect(url).toMatch(/^https:\/\/wa\.me\/5547991416694/);
      expect(url).toContain('text=');
      const encoded = url.split('text=')[1];
      expect(decodeURIComponent(encoded.replace(/\+/g, ' '))).toBe('Hello world');
    });
    it('handles newlines in message', () => {
      const url = buildWaMeUrl('5511999999999', 'Line1\nLine2');
      expect(url).toContain('5511999999999');
      const match = url.match(/text=([^&]*)/);
      expect(match).toBeTruthy();
      expect(decodeURIComponent(match[1])).toBe('Line1\nLine2');
    });
    it('returns null for empty contact', () => {
      expect(buildWaMeUrl('', 'Hi')).toBeNull();
      expect(buildWaMeUrl('  ', 'Hi')).toBeNull();
    });
  });

  describe('loadBatch', () => {
    it('loads and parses batch JSON', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-links-'));
      const file = path.join(dir, 'batch.json');
      fs.writeFileSync(
        file,
        JSON.stringify([
          { contact: '5511999999999', message: 'Test' },
        ])
      );
      try {
        const items = loadBatch(file);
        expect(Array.isArray(items)).toBe(true);
        expect(items).toHaveLength(1);
        expect(items[0].contact).toBe('5511999999999');
        expect(items[0].message).toBe('Test');
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
    it('throws if file not found', () => {
      expect(() => loadBatch('/nonexistent/batch.json')).toThrow('not found');
    });
    it('throws if not a non-empty array', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-links-'));
      const file = path.join(dir, 'batch.json');
      fs.writeFileSync(file, '[]');
      try {
        expect(() => loadBatch(file)).toThrow('non-empty array');
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe('escapeHtml', () => {
    it('escapes & < > "', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    });
  });

  describe('renderPage', () => {
    it('returns HTML with wa.me links for each item', () => {
      const items = [
        { contact: '5511999999999', message: 'Hi there' },
        { contact: '5547991416694', message: 'Second' },
      ];
      const html = renderPage(items);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('WhatsApp links');
      expect(html).toContain('2 contact(s)');
      expect(html).toContain('https://wa.me/5511999999999');
      expect(html).toContain('https://wa.me/5547991416694');
      expect(html).toContain('Hi there');
      expect(html).toContain('Second');
    });
  });

  describe('createWaLinksServer', () => {
    it('throws if batch file does not exist', () => {
      expect(() => createWaLinksServer('/nonexistent/batch.json', 0)).toThrow('not found');
    });
    it('starts server and responds with HTML on GET /', (done) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-links-'));
      const file = path.join(dir, 'batch.json');
      fs.writeFileSync(
        file,
        JSON.stringify([{ contact: '5511999999999', message: 'Test' }])
      );
      const port = 0; // let OS pick
      const server = createWaLinksServer(file, port);
      const actualPort = server.address().port;
      const req = require('http').request(
        { host: '127.0.0.1', port: actualPort, path: '/', method: 'GET' },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            expect(res.statusCode).toBe(200);
            expect(body).toContain('wa.me/5511999999999');
            server.close();
            fs.rmSync(dir, { recursive: true });
            done();
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        fs.rmSync(dir, { recursive: true });
        done(err);
      });
      req.end();
    });
    it('returns 404 for non-GET or non-root', (done) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-links-'));
      const file = path.join(dir, 'batch.json');
      fs.writeFileSync(
        file,
        JSON.stringify([{ contact: '5511999999999', message: 'Test' }])
      );
      const server = createWaLinksServer(file, 0);
      const port = server.address().port;
      const req = require('http').request(
        { host: '127.0.0.1', port, path: '/other', method: 'GET' },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            expect(res.statusCode).toBe(404);
            server.close();
            fs.rmSync(dir, { recursive: true });
            done();
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        fs.rmSync(dir, { recursive: true });
        done(err);
      });
      req.end();
    });
  });

  it('DEFAULT_PORT is number', () => {
    expect(typeof DEFAULT_PORT).toBe('number');
    expect(DEFAULT_PORT).toBeGreaterThan(0);
  });
});
