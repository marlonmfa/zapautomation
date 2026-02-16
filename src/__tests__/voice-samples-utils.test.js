const {
  normalizePhoneToDigits,
  senderDigits,
  isFromTargetNumber,
  isAudioMessage,
  extensionFromMimetype,
} = require('../voice-samples-utils');

describe('voice-samples-utils', () => {
  describe('normalizePhoneToDigits', () => {
    it('strips non-digits', () => {
      expect(normalizePhoneToDigits('+55 47 98868-5743')).toBe('5547988685743');
      expect(normalizePhoneToDigits('5547988685743')).toBe('5547988685743');
    });
    it('handles empty or undefined', () => {
      expect(normalizePhoneToDigits('')).toBe('');
      expect(normalizePhoneToDigits(undefined)).toBe('');
    });
  });

  describe('senderDigits', () => {
    it('extracts digits from WhatsApp id (private chat)', () => {
      expect(senderDigits({ from: '5547988685743@c.us' })).toBe('5547988685743');
    });
    it('prefers author when present (group)', () => {
      expect(senderDigits({ author: '5547988685743@c.us', from: '123@g.us' })).toBe('5547988685743');
    });
  });

  describe('isFromTargetNumber', () => {
    it('returns true when sender digits match target', () => {
      expect(isFromTargetNumber({ from: '5547988685743@c.us' }, '5547988685743')).toBe(true);
      expect(isFromTargetNumber({ author: '5547988685743@c.us' }, '5547988685743')).toBe(true);
    });
    it('returns false when sender does not match', () => {
      expect(isFromTargetNumber({ from: '5511999999999@c.us' }, '5547988685743')).toBe(false);
    });
  });

  describe('isAudioMessage', () => {
    it('returns true for ptt and audio', () => {
      expect(isAudioMessage({ type: 'ptt' })).toBe(true);
      expect(isAudioMessage({ type: 'audio' })).toBe(true);
    });
    it('returns false for text and other', () => {
      expect(isAudioMessage({ type: 'chat' })).toBe(false);
      expect(isAudioMessage({ type: 'image' })).toBe(false);
    });
  });

  describe('extensionFromMimetype', () => {
    it('returns correct extension for known types', () => {
      expect(extensionFromMimetype('audio/ogg')).toBe('.ogg');
      expect(extensionFromMimetype('audio/mpeg')).toBe('.mp3');
      expect(extensionFromMimetype('audio/mp4')).toBe('.m4a');
    });
    it('returns .ogg for unknown or empty', () => {
      expect(extensionFromMimetype(undefined)).toBe('.ogg');
      expect(extensionFromMimetype('audio/unknown')).toBe('.ogg');
    });
  });
});
