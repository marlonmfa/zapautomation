/**
 * Utilities for the voice-samples listener: normalize phone, detect sender, and file naming.
 */

function normalizePhoneToDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * @param {object} msg - whatsapp-web.js Message (has author or from)
 * @returns {string} - digits only from sender id
 */
function senderDigits(msg) {
  const id = msg.author || msg.from;
  return String(id || '').replace(/@.*$/, '').replace(/\D/g, '');
}

/**
 * @param {object} msg
 * @param {string} targetDigits - e.g. '5547988685743'
 */
function isFromTargetNumber(msg, targetDigits) {
  return senderDigits(msg) === targetDigits;
}

/**
 * @param {object} msg - msg.type === 'ptt' | 'audio'
 */
function isAudioMessage(msg) {
  return msg.type === 'ptt' || msg.type === 'audio';
}

function extensionFromMimetype(mimetype) {
  if (!mimetype) return '.ogg';
  const map = {
    'audio/ogg': '.ogg',
    'audio/oga': '.oga',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/webm': '.webm',
  };
  return map[mimetype] || '.ogg';
}

module.exports = {
  normalizePhoneToDigits,
  senderDigits,
  isFromTargetNumber,
  isAudioMessage,
  extensionFromMimetype,
};
