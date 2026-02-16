const { MessageMedia } = require('whatsapp-web.js');
const { sendOnce } = require('../batch-sender');
const { getBatchSendTimeoutMs } = require('../config');
const { textToSpeech } = require('./tts-voice');

/**
 * Convert text to speech (optionally with voice cloning from sample files) and send the audio to a WhatsApp number.
 * @param {import('whatsapp-web.js').Client} client - whatsapp-web.js Client (must be ready)
 * @param {string} contactId - Phone number or WhatsApp ID (e.g. "5511999999999" or "5511999999999@c.us")
 * @param {string} text - Text to synthesize and send as voice
 * @param {object} [options]
 * @param {string} [options.voiceId] - ElevenLabs voice ID (use this or voiceSamples)
 * @param {string[]} [options.voiceSamples] - Paths to audio files to clone voice from (synthesizes voice close to examples)
 * @param {string} [options.voiceName] - Name for cloned voice when using voiceSamples (optional)
 * @param {boolean} [options.removeBackgroundNoise] - Clean voice samples when cloning (default: false)
 * @param {string} [options.modelId] - ElevenLabs model (default: eleven_multilingual_v2)
 * @param {number} [options.stability] - Voice stability 0-1
 * @param {number} [options.similarityBoost] - Similarity to cloned voice 0-1
 * @param {number} [options.sendTimeoutMs] - Max wait for send (default from config)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendTextAsVoice(client, contactId, text, options = {}) {
  const sendTimeoutMs = options.sendTimeoutMs ?? getBatchSendTimeoutMs();

  const { audioBuffer, mimetype } = await textToSpeech(text, {
    voiceId: options.voiceId,
    voiceSamples: options.voiceSamples,
    voiceName: options.voiceName,
    removeBackgroundNoise: options.removeBackgroundNoise,
    modelId: options.modelId,
    stability: options.stability,
    similarityBoost: options.similarityBoost,
  });

  const base64 = audioBuffer.toString('base64');
  const media = new MessageMedia(mimetype, base64, 'audio.mp3');

  return sendOnce(client, contactId, media, sendTimeoutMs);
}

module.exports = {
  sendTextAsVoice,
};
