require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SESSION_ID = process.env.SESSION_ID || 'default';
const AUTH_DATA_PATH = process.env.AUTH_DATA_PATH || '.wwebjs_auth';
const BATCH_DELAY_MIN_MS = parseInt(process.env.BATCH_DELAY_MIN_MS || '5000', 10);
const BATCH_DELAY_MAX_MS = parseInt(process.env.BATCH_DELAY_MAX_MS || '30000', 10);
const BATCH_SEND_TIMEOUT_MS = parseInt(process.env.BATCH_SEND_TIMEOUT_MS || '60000', 10);
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

const SYSTEM_CHROME_PATHS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  win32: [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
  ],
};

function getAuthDataPath() {
  return AUTH_DATA_PATH;
}

function getSessionClientId() {
  return SESSION_ID;
}

function getBatchDelayRange() {
  return { minMs: BATCH_DELAY_MIN_MS, maxMs: BATCH_DELAY_MAX_MS };
}

function getBatchSendTimeoutMs() {
  return BATCH_SEND_TIMEOUT_MS;
}

function getPuppeteerExecutablePath() {
  if (PUPPETEER_EXECUTABLE_PATH) return PUPPETEER_EXECUTABLE_PATH;
  const candidates = SYSTEM_CHROME_PATHS[process.platform];
  if (!candidates) return undefined;
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return undefined;
}

/**
 * Returns OpenAI API key for transcription and reply suggestion. Throws if not set.
 * @returns {string}
 */
function getOpenAiApiKey() {
  const key = (OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  if (!key) {
    throw new Error('OPENAI_API_KEY is required for transcription and reply suggestion. Set it in .env');
  }
  return key;
}

/**
 * Returns ElevenLabs API key for TTS and voice cloning. Throws if not set.
 * @returns {string}
 */
function getElevenLabsApiKey() {
  const key = (ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) {
    throw new Error('ELEVENLABS_API_KEY is required for text-to-speech and voice cloning. Set it in .env');
  }
  return key;
}

module.exports = {
  getAuthDataPath,
  getSessionClientId,
  getBatchDelayRange,
  getBatchSendTimeoutMs,
  getPuppeteerExecutablePath,
  getOpenAiApiKey,
  getElevenLabsApiKey,
  SESSION_ID,
  AUTH_DATA_PATH,
  BATCH_DELAY_MIN_MS,
  BATCH_DELAY_MAX_MS,
  BATCH_SEND_TIMEOUT_MS,
};
