const { toBrazilWhatsApp, firstName, isExcludedContact } = require('../batch-lucas-utils');

describe('toBrazilWhatsApp', () => {
  it('strips non-digits and ensures 55 prefix', () => {
    expect(toBrazilWhatsApp('+55 47 99914 16694')).toBe('55479991416694');
    expect(toBrazilWhatsApp('47991416694')).toBe('5547991416694');
  });

  it('keeps 55 when already present', () => {
    expect(toBrazilWhatsApp('5547991416694')).toBe('5547991416694');
    expect(toBrazilWhatsApp('p:+5547991416694')).toBe('5547991416694');
  });

  it('removes duplicate leading 55', () => {
    expect(toBrazilWhatsApp('+55+5547991287012')).toBe('5547991287012');
    expect(toBrazilWhatsApp('555547991287012')).toBe('5547991287012');
  });

  it('returns empty string for empty input', () => {
    expect(toBrazilWhatsApp('')).toBe('');
    expect(toBrazilWhatsApp('  ')).toBe('');
  });
});

describe('firstName', () => {
  it('returns first word of full name', () => {
    expect(firstName('Elis Regina')).toBe('Elis');
    expect(firstName('Jorge')).toBe('Jorge');
    expect(firstName('Alexander da Silva Alchini')).toBe('Alexander');
  });

  it('handles empty or whitespace', () => {
    expect(firstName('')).toBe('Olá');
    expect(firstName('   ')).toBe('Olá');
  });

  it('returns single name as-is', () => {
    expect(firstName('Cleonice')).toBe('Cleonice');
  });
});

describe('isExcludedContact', () => {
  it('returns true for Osmar Pereira Junior (with or without accent)', () => {
    expect(isExcludedContact('Osmar Pereira Júnior')).toBe(true);
    expect(isExcludedContact('Osmar Pereira Junior')).toBe(true);
  });

  it('returns true for Perdao Perdao', () => {
    expect(isExcludedContact('Perdao Perdao')).toBe(true);
    expect(isExcludedContact('Perdão Perdão')).toBe(true);
  });

  it('returns true for Martinho Rogerio', () => {
    expect(isExcludedContact('Martinho Rogerio de Campos')).toBe(true);
    expect(isExcludedContact('Martinho Rogerio')).toBe(true);
  });

  it('returns false for other names', () => {
    expect(isExcludedContact('Elis Regina')).toBe(false);
    expect(isExcludedContact('Jorge')).toBe(false);
    expect(isExcludedContact('')).toBe(false);
  });
});
