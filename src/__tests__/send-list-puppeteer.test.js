const { normalizeContact, randomDelayMs, sleep } = require('../scripts/send-list-puppeteer');

describe('send-list-puppeteer', () => {
  describe('normalizeContact', () => {
    it('strips non-digits and adds 55 prefix for Brazilian numbers', () => {
      expect(normalizeContact('+55 47 99914 16694')).toBe('55479991416694');
      expect(normalizeContact('47991416694')).toBe('5547991416694');
    });

    it('keeps 55 when already present', () => {
      expect(normalizeContact('5547991416694')).toBe('5547991416694');
    });

    it('returns empty string for empty or non-digit input', () => {
      expect(normalizeContact('')).toBe('');
      expect(normalizeContact('  ')).toBe('');
    });
  });

  describe('randomDelayMs', () => {
    it('returns a number within [minMs, maxMs]', () => {
      for (let i = 0; i < 50; i++) {
        const d = randomDelayMs(1000, 3000);
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThanOrEqual(3000);
      }
    });

    it('returns min when min === max', () => {
      expect(randomDelayMs(500, 500)).toBe(500);
    });
  });

  describe('sleep', () => {
    it('resolves after roughly the given ms', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });
});
