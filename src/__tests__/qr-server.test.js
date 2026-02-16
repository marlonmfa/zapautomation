const { createQRServer, getQRServerHTML } = require('../qr-server');

describe('qr-server', () => {
  it('exports createQRServer function', () => {
    expect(typeof createQRServer).toBe('function');
  });

  it('exports getQRServerHTML returning HTML with WhatsApp Sync and SSE', () => {
    const html = getQRServerHTML();
    expect(html).toContain('WhatsApp Sync');
    expect(html).toContain('Scan');
    expect(html).toContain('/events');
    expect(html).toContain('EventSource');
  });
});
