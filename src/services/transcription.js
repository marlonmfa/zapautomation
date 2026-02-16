const { getOpenAiApiKey } = require('../config');

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = 'whisper-1';

/**
 * Transcribes audio buffer using OpenAI Whisper API.
 * @param {Buffer} audioBuffer - Raw audio bytes (e.g. ogg from WhatsApp voice message)
 * @param {string} [mimetype] - MIME type e.g. 'audio/ogg'
 * @param {string} [language] - Optional language hint (e.g. 'pt' for Portuguese)
 * @returns {Promise<string>} - Transcribed text
 */
async function transcribeAudio(audioBuffer, mimetype = 'audio/ogg', language = 'pt') {
  const apiKey = getOpenAiApiKey();
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    throw new Error('transcribeAudio expects a non-empty Buffer');
  }

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimetype });
  formData.append('file', blob, 'audio.ogg');
  formData.append('model', MODEL);
  formData.append('language', language);

  const response = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Whisper API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  return typeof data.text === 'string' ? data.text.trim() : '';
}

module.exports = {
  transcribeAudio,
};
