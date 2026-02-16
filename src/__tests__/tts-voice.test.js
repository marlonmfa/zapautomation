describe('tts-voice', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;
  const originalFs = require('fs');

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, ELEVENLABS_API_KEY: 'xi-test-key' };
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  describe('textToSpeech', () => {
    it('throws if ELEVENLABS_API_KEY is not set', async () => {
      delete process.env.ELEVENLABS_API_KEY;
      jest.resetModules();
      const { textToSpeech } = require('../services/tts-voice');
      await expect(textToSpeech('hi', { voiceId: 'v1' })).rejects.toThrow('ELEVENLABS_API_KEY is required');
    });

    it('throws if text is empty', async () => {
      jest.resetModules();
      const { textToSpeech } = require('../services/tts-voice');
      await expect(textToSpeech('', { voiceId: 'v1' })).rejects.toThrow('text is required');
      await expect(textToSpeech('   ', { voiceId: 'v1' })).rejects.toThrow('text is required');
    });

    it('throws if neither voiceId nor voiceSamples provided', async () => {
      jest.resetModules();
      const { textToSpeech } = require('../services/tts-voice');
      await expect(textToSpeech('hello', {})).rejects.toThrow('voiceId or voiceSamples');
    });

    it('returns audio buffer and mimetype when using voiceId', async () => {
      const mp3Bytes = new Uint8Array([0xff, 0xfb, 0x90]);
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mp3Bytes.slice().buffer),
      });
      jest.resetModules();
      const { textToSpeech } = require('../services/tts-voice');
      const result = await textToSpeech('Hello world', { voiceId: 'voice-123' });
      expect(Buffer.isBuffer(result.audioBuffer)).toBe(true);
      expect(result.audioBuffer.length).toBeGreaterThanOrEqual(3);
      expect(result.audioBuffer[0]).toBe(0xff);
      expect(result.audioBuffer[1]).toBe(0xfb);
      expect(result.audioBuffer[2]).toBe(0x90);
      expect(result.mimetype).toBe('audio/mpeg');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/voice-123?output_format=mp3_44100_128',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': 'xi-test-key',
          },
          body: JSON.stringify({ text: 'Hello world', model_id: 'eleven_multilingual_v2' }),
        })
      );
    });

    it('throws on TTS API error', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('Invalid voice'),
      });
      jest.resetModules();
      const { textToSpeech } = require('../services/tts-voice');
      await expect(textToSpeech('hi', { voiceId: 'bad' })).rejects.toThrow('ElevenLabs TTS error 422');
    });
  });

  describe('createVoiceFromSamples', () => {
    it('throws if ELEVENLABS_API_KEY is not set', async () => {
      delete process.env.ELEVENLABS_API_KEY;
      jest.resetModules();
      const { createVoiceFromSamples } = require('../services/tts-voice');
      await expect(createVoiceFromSamples(['/tmp/s.mp3'])).rejects.toThrow('ELEVENLABS_API_KEY is required');
    });

    it('throws if samplePaths is empty', async () => {
      jest.resetModules();
      const { createVoiceFromSamples } = require('../services/tts-voice');
      await expect(createVoiceFromSamples([])).rejects.toThrow('At least one audio sample path');
    });

    it('calls voices/add with FormData and returns voice_id', async () => {
      const readFileSync = jest.spyOn(originalFs, 'readFileSync').mockReturnValue(Buffer.from([0x00, 0x01]));
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ voice_id: 'new-voice-id', requires_verification: false }),
      });
      jest.resetModules();
      const { createVoiceFromSamples } = require('../services/tts-voice');
      const result = await createVoiceFromSamples(['/path/sample.mp3']);
      expect(result).toEqual({ voiceId: 'new-voice-id', requiresVerification: false });
      expect(readFileSync).toHaveBeenCalledWith('/path/sample.mp3');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/add',
        expect.objectContaining({
          method: 'POST',
          headers: { 'xi-api-key': 'xi-test-key' },
        })
      );
      const callBody = globalThis.fetch.mock.calls[0][1].body;
      expect(callBody).toBeInstanceOf(FormData);
      readFileSync.mockRestore();
    });

    it('throws on add voice API error', async () => {
      jest.spyOn(originalFs, 'readFileSync').mockReturnValue(Buffer.from([0x00]));
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
      });
      jest.resetModules();
      const { createVoiceFromSamples } = require('../services/tts-voice');
      await expect(createVoiceFromSamples(['/tmp/s.mp3'])).rejects.toThrow('ElevenLabs add voice error 400');
    });
  });

  describe('textToSpeech with voiceSamples', () => {
    it('creates voice from samples then calls TTS', async () => {
      const readFileSync = jest.spyOn(originalFs, 'readFileSync').mockReturnValue(Buffer.from([0x00]));
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation((url) => {
        callCount++;
        if (url.includes('/voices/add')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ voice_id: 'cloned-voice-id', requires_verification: false }),
          });
        }
        if (url.includes('/text-to-speech/')) {
          const oneByte = new Uint8Array([0xff]);
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(oneByte.slice().buffer),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });
      jest.resetModules();
      const { textToSpeech } = require('../services/tts-voice');
      const result = await textToSpeech('Oi', {
        voiceSamples: ['/audio/s1.mp3', '/audio/s2.wav'],
      });
      expect(result.audioBuffer.length).toBeGreaterThanOrEqual(1);
      expect(result.mimetype).toBe('audio/mpeg');
      expect(callCount).toBe(2);
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        1,
        'https://api.elevenlabs.io/v1/voices/add',
        expect.any(Object)
      );
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        2,
        'https://api.elevenlabs.io/v1/text-to-speech/cloned-voice-id?output_format=mp3_44100_128',
        expect.any(Object)
      );
      readFileSync.mockRestore();
    });
  });
});
