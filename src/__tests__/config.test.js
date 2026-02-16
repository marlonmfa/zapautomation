const path = require('path');

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('getSessionClientId returns SESSION_ID or default', () => {
    delete process.env.SESSION_ID;
    const config = require('../config');
    expect(config.getSessionClientId()).toBe('default');

    process.env.SESSION_ID = 'my-phone';
    jest.resetModules();
    const config2 = require('../config');
    expect(config2.getSessionClientId()).toBe('my-phone');
  });

  it('getAuthDataPath returns AUTH_DATA_PATH or default', () => {
    delete process.env.AUTH_DATA_PATH;
    const config = require('../config');
    expect(config.getAuthDataPath()).toBe('.wwebjs_auth');

    process.env.AUTH_DATA_PATH = '/custom/path';
    jest.resetModules();
    const config2 = require('../config');
    expect(config2.getAuthDataPath()).toBe('/custom/path');
  });

  it('getBatchDelayRange returns min/max from env or defaults', () => {
    delete process.env.BATCH_DELAY_MIN_MS;
    delete process.env.BATCH_DELAY_MAX_MS;
    const config = require('../config');
    const range = config.getBatchDelayRange();
    expect(range.minMs).toBe(5000);
    expect(range.maxMs).toBe(30000);

    process.env.BATCH_DELAY_MIN_MS = '1000';
    process.env.BATCH_DELAY_MAX_MS = '10000';
    jest.resetModules();
    const config2 = require('../config');
    const range2 = config2.getBatchDelayRange();
    expect(range2.minMs).toBe(1000);
    expect(range2.maxMs).toBe(10000);
  });

  it('getOpenAiApiKey throws when OPENAI_API_KEY is not set', () => {
    delete process.env.OPENAI_API_KEY;
    const config = require('../config');
    expect(() => config.getOpenAiApiKey()).toThrow('OPENAI_API_KEY is required');
  });

  it('getOpenAiApiKey returns key when set', () => {
    process.env.OPENAI_API_KEY = 'sk-abc123';
    jest.resetModules();
    const config = require('../config');
    expect(config.getOpenAiApiKey()).toBe('sk-abc123');
  });

  it('getElevenLabsApiKey throws when ELEVENLABS_API_KEY is not set', () => {
    delete process.env.ELEVENLABS_API_KEY;
    const config = require('../config');
    expect(() => config.getElevenLabsApiKey()).toThrow('ELEVENLABS_API_KEY is required');
  });

  it('getElevenLabsApiKey returns key when set', () => {
    process.env.ELEVENLABS_API_KEY = 'xi-test-key';
    jest.resetModules();
    const config = require('../config');
    expect(config.getElevenLabsApiKey()).toBe('xi-test-key');
  });
});
