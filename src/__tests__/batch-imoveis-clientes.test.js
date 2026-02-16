const fs = require('fs');
const path = require('path');
const { toBrazilWhatsApp, firstName } = require('../batch-lucas-utils');

const batchPath = path.join(process.cwd(), 'batch_imoveis_clientes.json');

describe('batch_imoveis_clientes.json', () => {
  let items;

  beforeAll(() => {
    const raw = fs.readFileSync(batchPath, 'utf8');
    items = JSON.parse(raw);
  });

  it('exists and is a non-empty array', () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  it('each item has contact and message', () => {
    items.forEach((item, i) => {
      expect(item).toHaveProperty('contact');
      expect(item).toHaveProperty('message');
      expect(typeof item.contact).toBe('string');
      expect(typeof item.message).toBe('string');
      expect(item.contact.length).toBeGreaterThanOrEqual(12);
      expect(item.message.length).toBeGreaterThan(0);
    });
  });

  it('each message follows the imóveis template (Oi NOME, bom dia! ...)', () => {
    const expectedStart = 'Oi ';
    const expectedBomDia = ' bom dia!';
    const expectedBody = '\nComo está a sua pesquisa por imóveis? Posso te ajudar a encontrar algo similar ao que você está procurando?';
    items.forEach((item) => {
      expect(item.message.startsWith(expectedStart)).toBe(true);
      expect(item.message).toContain(expectedBomDia);
      expect(item.message).toContain(expectedBody);
    });
  });

  it('contacts are valid Brazil WhatsApp format (digits, 55 prefix)', () => {
    items.forEach((item) => {
      const normalized = toBrazilWhatsApp(item.contact);
      expect(normalized).toBe(item.contact);
      expect(/^55\d{11,12}$/.test(normalized)).toBe(true);
    });
  });
});
