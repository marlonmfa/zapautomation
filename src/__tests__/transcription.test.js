describe('transcription', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it('throws if OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    jest.resetModules();
    const { transcribeAudio } = require('../services/transcription');
    await expect(transcribeAudio(Buffer.from('fake'))).rejects.toThrow('OPENAI_API_KEY is required');
  });

  it('throws if audioBuffer is empty', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    jest.resetModules();
    const { transcribeAudio } = require('../services/transcription');
    await expect(transcribeAudio(Buffer.alloc(0))).rejects.toThrow('non-empty Buffer');
  });

  it('returns transcribed text on success', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: ' Olá, tudo bem? ' }),
    });
    jest.resetModules();
    const { transcribeAudio } = require('../services/transcription');
    const result = await transcribeAudio(Buffer.from('fake-ogg'));
    expect(result).toBe('Olá, tudo bem?');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer sk-test' },
      })
    );
  });

  it('throws on API error response', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Invalid API key'),
    });
    jest.resetModules();
    const { transcribeAudio } = require('../services/transcription');
    await expect(transcribeAudio(Buffer.from('x'))).rejects.toThrow('Whisper API error 401');
  });
});
