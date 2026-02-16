/**
 * Listen for incoming WhatsApp messages and save audio (voice) messages from a
 * specific number locally for voice synthesizer / TTS training.
 *
 * Target number: set VOICE_SAMPLES_PHONE in .env (e.g. "5547988685743" or "+55 47 98868-5743").
 * Default: +55 47 98868-5743 (normalized: 5547988685743).
 * Usage: npm run listen:voice-samples
 *
 * Saves files to ./audio-samples-voice-synth/ as sample_001.ogg, sample_002.ogg, ...
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { createClient } = require('../client');
const { attachListeners } = require('../listeners');
const {
  normalizePhoneToDigits,
  isFromTargetNumber: isFromTarget,
  isAudioMessage,
  extensionFromMimetype,
} = require('../voice-samples-utils');

/** WhatsApp sender id: digits only. From env or default +55 47 98868-5743. */
const TARGET_NUMBER_DIGITS = normalizePhoneToDigits(
  process.env.VOICE_SAMPLES_PHONE || '5547988685743'
);

const OUT_DIR = path.join(process.cwd(), 'audio-samples-voice-synth');

function isFromTargetNumber(msg) {
  return isFromTarget(msg, TARGET_NUMBER_DIGITS);
}

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log('[voice-samples] Created directory:', OUT_DIR);
  }
}

function nextSamplePath(ext) {
  ensureOutDir();
  const existing = fs.readdirSync(OUT_DIR);
  const numbers = existing
    .map((f) => f.match(/^sample_(\d+)\./))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  const next = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  return path.join(OUT_DIR, `sample_${String(next).padStart(3, '0')}${ext}`);
}

async function saveAudioFromMessage(msg) {
  if (!isFromTargetNumber(msg) || !isAudioMessage(msg)) return;

  try {
    const media = await msg.downloadMedia();
    if (!media || !media.data) {
      console.error('[voice-samples] No media data for message from', msg.from);
      return;
    }

    const buffer = Buffer.from(media.data, 'base64');
    const ext = extensionFromMimetype(media.mimetype);
    const filePath = nextSamplePath(ext);

    fs.writeFileSync(filePath, buffer);
    console.log('[voice-samples] Saved:', filePath);
  } catch (err) {
    console.error('[voice-samples] Failed to save audio:', err.message);
  }
}

const client = createClient({ headless: true });

attachListeners(client, {
  onMessage(msg) {
    saveAudioFromMessage(msg).catch((err) => console.error('[voice-samples]', err.message));
  },
});

client.on('qr', (qr) => {
  console.log('QR received. Run "npm run session" first to authenticate.');
});

client.on('auth_failure', (msg) => {
  console.error('Auth failure:', msg);
  process.exit(1);
});

client.on('ready', () => {
  console.log('Listening for voice messages from', TARGET_NUMBER_DIGITS, '→', OUT_DIR);
});

client.initialize().catch((err) => {
  console.error('Initialize failed:', err);
  process.exit(1);
});
