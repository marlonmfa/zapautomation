const fs = require('fs');
const path = require('path');
const { getElevenLabsApiKey } = require('../config');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

/**
 * Create an instant voice clone from audio sample files via ElevenLabs API.
 * @param {string[]} samplePaths - Absolute or relative paths to audio files (mp3, wav, etc.)
 * @param {object} [options]
 * @param {string} [options.voiceName] - Name for the cloned voice (default: cloned-{timestamp})
 * @param {boolean} [options.removeBackgroundNoise] - Clean samples (default: false)
 * @returns {Promise<{ voiceId: string, requiresVerification: boolean }>}
 */
async function createVoiceFromSamples(samplePaths, options = {}) {
  const apiKey = getElevenLabsApiKey();
  if (!Array.isArray(samplePaths) || samplePaths.length === 0) {
    throw new Error('At least one audio sample path is required for voice cloning');
  }

  const form = new FormData();
  form.append('name', options.voiceName || `cloned-${Date.now()}`);
  if (options.removeBackgroundNoise === true) {
    form.append('remove_background_noise', 'true');
  }

  for (let i = 0; i < samplePaths.length; i++) {
    const filePath = samplePaths[i];
    const buf = fs.readFileSync(filePath);
    const name = path.basename(filePath) || `sample-${i}.mp3`;
    const ext = path.extname(name).toLowerCase();
    const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
    form.append('files', new Blob([buf], { type: mime }), name);
  }

  const response = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: form,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`ElevenLabs add voice error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  return {
    voiceId: data.voice_id,
    requiresVerification: Boolean(data.requires_verification),
  };
}

/**
 * Convert text to speech using ElevenLabs.
 * @param {string} text - Text to synthesize
 * @param {object} [options]
 * @param {string} [options.voiceId] - ElevenLabs voice ID (required if voiceSamples not provided)
 * @param {string[]} [options.voiceSamples] - Paths to audio files to clone voice from (used if voiceId not set)
 * @param {string} [options.modelId] - Model ID (default: eleven_multilingual_v2)
 * @param {string} [options.outputFormat] - e.g. mp3_44100_128 (default)
 * @param {number} [options.stability] - Voice stability 0-1
 * @param {number} [options.similarityBoost] - Similarity to original 0-1
 * @returns {Promise<{ audioBuffer: Buffer, mimetype: string }>}
 */
async function textToSpeech(text, options = {}) {
  const apiKey = getElevenLabsApiKey();
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('text is required and must be non-empty');
  }

  let voiceId = options.voiceId;
  if (!voiceId && options.voiceSamples && options.voiceSamples.length > 0) {
    const created = await createVoiceFromSamples(options.voiceSamples, {
      voiceName: options.voiceName,
      removeBackgroundNoise: options.removeBackgroundNoise,
    });
    voiceId = created.voiceId;
  }
  if (!voiceId) {
    throw new Error('Either voiceId or voiceSamples (array of audio file paths) must be provided');
  }

  const modelId = options.modelId || DEFAULT_MODEL;
  const outputFormat = options.outputFormat || DEFAULT_OUTPUT_FORMAT;
  const body = {
    text: text.trim(),
    model_id: modelId,
  };
  if (options.stability != null || options.similarity_boost != null) {
    body.voice_settings = {};
    if (options.stability != null) body.voice_settings.stability = options.stability;
    if (options.similarityBoost != null) body.voice_settings.similarity_boost = options.similarityBoost;
    if (options.similarity_boost != null) body.voice_settings.similarity_boost = options.similarity_boost;
  }

  const response = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`ElevenLabs TTS error ${response.status}: ${errBody}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);
  const mimetype = outputFormat.startsWith('mp3') ? 'audio/mpeg' : outputFormat.startsWith('opus') ? 'audio/ogg' : 'audio/mpeg';
  return { audioBuffer, mimetype };
}

module.exports = {
  createVoiceFromSamples,
  textToSpeech,
};
