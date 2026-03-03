require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SESSION_ID = process.env.SESSION_ID || 'default';
const AUTH_DATA_PATH = process.env.AUTH_DATA_PATH || '.wwebjs_auth';
const BATCH_DELAY_MIN_MS = parseInt(process.env.BATCH_DELAY_MIN_MS || '3000', 10);
const BATCH_DELAY_MAX_MS = parseInt(process.env.BATCH_DELAY_MAX_MS || '7000', 10);
const BATCH_SEND_TIMEOUT_MS = parseInt(process.env.BATCH_SEND_TIMEOUT_MS || '15000', 10);
/** When 'false', send to all contacts (do not skip those who already received a message). Default: 'true' */
/** Quando true, pula contatos que já receberam qualquer mensagem nossa. Quando false (padrão), envia sempre (mensagem inicial mesmo se já tiver conversa). */
const BATCH_SKIP_IF_EVER_SENT = process.env.BATCH_SKIP_IF_EVER_SENT === 'true';
const BATCH_REQUIRE_OPT_IN = process.env.BATCH_REQUIRE_OPT_IN === 'true';
const BATCH_SUPPRESSION_FILE = (process.env.BATCH_SUPPRESSION_FILE || '').trim();
const BATCH_MAX_PER_RUN = parseInt(process.env.BATCH_MAX_PER_RUN || '0', 10);
const BATCH_COOLDOWN_EVERY = parseInt(process.env.BATCH_COOLDOWN_EVERY || '0', 10);
const BATCH_COOLDOWN_MIN_MS = parseInt(process.env.BATCH_COOLDOWN_MIN_MS || '90000', 10);
const BATCH_COOLDOWN_MAX_MS = parseInt(process.env.BATCH_COOLDOWN_MAX_MS || '180000', 10);
const BATCH_STOP_FAIL_RATE = parseFloat(process.env.BATCH_STOP_FAIL_RATE || '0.25');
const BATCH_STOP_MIN_ATTEMPTS = parseInt(process.env.BATCH_STOP_MIN_ATTEMPTS || '20', 10);
const BATCH_BLOCKLIKE_STOP_COUNT = parseInt(process.env.BATCH_BLOCKLIKE_STOP_COUNT || '5', 10);
const ENABLE_FIRST_CONTACT_AGENT = process.env.ENABLE_FIRST_CONTACT_AGENT === 'true' || process.env.ENABLE_FIRST_CONTACT_AGENT === '1';
const FIRST_CONTACT_CONFIDENCE_THRESHOLD = parseFloat(process.env.FIRST_CONTACT_CONFIDENCE_THRESHOLD || '0.72');
const FIRST_CONTACT_REPLY_DELAY_MIN_MS = parseInt(process.env.FIRST_CONTACT_REPLY_DELAY_MIN_MS || '500', 10);
const FIRST_CONTACT_REPLY_DELAY_MAX_MS = parseInt(process.env.FIRST_CONTACT_REPLY_DELAY_MAX_MS || '2000', 10);
const FIRST_CONTACT_MEMORY_PATH = process.env.FIRST_CONTACT_MEMORY_PATH || 'data/first-contact-memory.json';
const FIRST_CONTACT_DECISIONS_LOG_PATH = process.env.FIRST_CONTACT_DECISIONS_LOG_PATH || 'data/first-contact-decisions.jsonl';
const FIRST_CONTACT_REQUIRE_HUMAN_FOR_SENSITIVE = process.env.FIRST_CONTACT_REQUIRE_HUMAN_FOR_SENSITIVE !== 'false';
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
/** Path to a PDF file whose text is used as extra knowledge for the first-contact AI (optional). */
const AI_KNOWLEDGE_PDF = (process.env.AI_KNOWLEDGE_PDF || process.env.FIRST_CONTACT_KNOWLEDGE_PDF || '').trim();
/** Path to a text/markdown file with real estate context (Joinville, interest rates, etc.) for the first-contact AI. Default: knowledge/contexto-joinville-juros.md */
const AI_KNOWLEDGE_CONTEXTO = (process.env.AI_KNOWLEDGE_CONTEXTO || 'knowledge/contexto-joinville-juros.md').trim();

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

function getBatchSkipIfEverSent() {
  return BATCH_SKIP_IF_EVER_SENT;
}

function getBatchRequireOptIn() {
  return BATCH_REQUIRE_OPT_IN;
}

function getBatchSuppressionFile() {
  return BATCH_SUPPRESSION_FILE;
}

function getBatchMaxPerRun() {
  return Number.isFinite(BATCH_MAX_PER_RUN) ? BATCH_MAX_PER_RUN : 0;
}

function getBatchCooldown() {
  return {
    every: Number.isFinite(BATCH_COOLDOWN_EVERY) ? BATCH_COOLDOWN_EVERY : 0,
    minMs: Number.isFinite(BATCH_COOLDOWN_MIN_MS) ? BATCH_COOLDOWN_MIN_MS : 90000,
    maxMs: Number.isFinite(BATCH_COOLDOWN_MAX_MS) ? BATCH_COOLDOWN_MAX_MS : 180000,
  };
}

function getBatchHealthStopRules() {
  return {
    failRate: Number.isFinite(BATCH_STOP_FAIL_RATE) ? BATCH_STOP_FAIL_RATE : 0.25,
    minAttempts: Number.isFinite(BATCH_STOP_MIN_ATTEMPTS) ? BATCH_STOP_MIN_ATTEMPTS : 20,
    blockLikeCount: Number.isFinite(BATCH_BLOCKLIKE_STOP_COUNT) ? BATCH_BLOCKLIKE_STOP_COUNT : 5,
  };
}

function isFirstContactAgentEnabled() {
  return ENABLE_FIRST_CONTACT_AGENT;
}

function getFirstContactConfidenceThreshold() {
  return Number.isFinite(FIRST_CONTACT_CONFIDENCE_THRESHOLD) ? FIRST_CONTACT_CONFIDENCE_THRESHOLD : 0.72;
}

function getFirstContactReplyDelayRange() {
  return {
    minMs: Number.isFinite(FIRST_CONTACT_REPLY_DELAY_MIN_MS) ? FIRST_CONTACT_REPLY_DELAY_MIN_MS : 500,
    maxMs: Number.isFinite(FIRST_CONTACT_REPLY_DELAY_MAX_MS) ? FIRST_CONTACT_REPLY_DELAY_MAX_MS : 2000,
  };
}

function getFirstContactMemoryPath() {
  return FIRST_CONTACT_MEMORY_PATH;
}

function getFirstContactDecisionsLogPath() {
  return FIRST_CONTACT_DECISIONS_LOG_PATH;
}

function getFirstContactRequireHumanForSensitive() {
  return FIRST_CONTACT_REQUIRE_HUMAN_FOR_SENSITIVE;
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

/**
 * Returns the path to the PDF file used as knowledge base for the first-contact AI. Empty if not set.
 * @returns {string}
 */
function getAiKnowledgePdfPath() {
  return AI_KNOWLEDGE_PDF || '';
}

/**
 * Returns the path to the context knowledge file (Joinville, interest rates, etc.). Empty if disabled.
 * @returns {string}
 */
function getAiKnowledgeContextoPath() {
  return AI_KNOWLEDGE_CONTEXTO || '';
}

module.exports = {
  getAuthDataPath,
  getSessionClientId,
  getBatchDelayRange,
  getBatchSendTimeoutMs,
  getBatchSkipIfEverSent,
  getBatchRequireOptIn,
  getBatchSuppressionFile,
  getBatchMaxPerRun,
  getBatchCooldown,
  getBatchHealthStopRules,
  isFirstContactAgentEnabled,
  getFirstContactConfidenceThreshold,
  getFirstContactReplyDelayRange,
  getFirstContactMemoryPath,
  getFirstContactDecisionsLogPath,
  getFirstContactRequireHumanForSensitive,
  getPuppeteerExecutablePath,
  getOpenAiApiKey,
  getElevenLabsApiKey,
  getAiKnowledgePdfPath,
  getAiKnowledgeContextoPath,
  SESSION_ID,
  AUTH_DATA_PATH,
  BATCH_DELAY_MIN_MS,
  BATCH_DELAY_MAX_MS,
  BATCH_SEND_TIMEOUT_MS,
  BATCH_REQUIRE_OPT_IN,
  BATCH_SUPPRESSION_FILE,
  BATCH_MAX_PER_RUN,
  BATCH_COOLDOWN_EVERY,
  BATCH_COOLDOWN_MIN_MS,
  BATCH_COOLDOWN_MAX_MS,
  BATCH_STOP_FAIL_RATE,
  BATCH_STOP_MIN_ATTEMPTS,
  BATCH_BLOCKLIKE_STOP_COUNT,
  ENABLE_FIRST_CONTACT_AGENT,
  FIRST_CONTACT_CONFIDENCE_THRESHOLD,
  FIRST_CONTACT_REPLY_DELAY_MIN_MS,
  FIRST_CONTACT_REPLY_DELAY_MAX_MS,
  FIRST_CONTACT_MEMORY_PATH,
  FIRST_CONTACT_DECISIONS_LOG_PATH,
  FIRST_CONTACT_REQUIRE_HUMAN_FOR_SENSITIVE,
  AI_KNOWLEDGE_PDF,
  AI_KNOWLEDGE_CONTEXTO,
};
