/**
 * Utilities for building batch_lucas contact list and messages.
 */

/** Full names to exclude from batch lists (case-insensitive, normalized). */
const EXCLUDED_FULL_NAMES = [
  'osmar pereira junior',
  'osmar pereira júnior',
  'perdao perdao',
  'perdão perdão',
  'martinho rogerio',
  'martinho rogerio de campos',
];

/**
 * Normalize name for comparison: lowercase, collapse spaces, remove accents.
 * @param {string} name
 * @returns {string}
 */
function normalizeNameForExclusion(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

/**
 * Check if a full name is in the exclusion list.
 * @param {string} fullName
 * @returns {boolean}
 */
function isExcludedContact(fullName) {
  const normalized = normalizeNameForExclusion(fullName);
  if (!normalized) return false;
  return EXCLUDED_FULL_NAMES.some((excluded) => normalized.includes(excluded) || excluded.includes(normalized));
}

/**
 * Normalize phone to Brazil WhatsApp: digits only, ensure starts with 55.
 * Removes duplicate leading 55 if present.
 * @param {string} raw - e.g. "p:+5547991416694" or "+55 47 99912 87012"
 * @returns {string} e.g. "5547991416694"
 */
function toBrazilWhatsApp(raw) {
  let digits = String(raw).replace(/\D/g, '');
  if (!digits.length) return '';
  if (!digits.startsWith('55')) digits = `55${digits}`;
  while (digits.length > 13 && digits.startsWith('5555')) digits = '55' + digits.slice(4);
  return digits;
}

/**
 * Get first name from full name (first word).
 * @param {string} fullName
 * @returns {string}
 */
function firstName(fullName) {
  const name = String(fullName || '').trim();
  const first = name.split(/\s+/)[0] || name;
  return first || 'Olá';
}

module.exports = { toBrazilWhatsApp, firstName, isExcludedContact, EXCLUDED_FULL_NAMES };
