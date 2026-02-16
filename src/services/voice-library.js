/**
 * Voice library: text-to-speech with optional voice cloning and send audio to WhatsApp.
 *
 * Usage:
 *   const { sendTextAsVoice, textToSpeech, createVoiceFromSamples } = require('./services/voice-library');
 *
 *   // Send text as voice using an existing ElevenLabs voice ID
 *   await sendTextAsVoice(client, '5511999999999', 'Olá, tudo bem?', { voiceId: 'your-voice-id' });
 *
 *   // Send text as voice using cloned voice from sample audio files
 *   await sendTextAsVoice(client, '5511999999999', 'Olá, tudo bem?', {
 *     voiceSamples: ['/path/to/sample1.mp3', '/path/to/sample2.wav'],
 *     similarityBoost: 0.8,
 *   });
 *
 *   // Only generate TTS buffer (no send)
 *   const { audioBuffer, mimetype } = await textToSpeech('Hello', { voiceId: '...' });
 *
 *   // Create a voice from samples and get voice_id for reuse
 *   const { voiceId } = await createVoiceFromSamples(['sample.mp3'], { voiceName: 'my-voice' });
 */

const { createVoiceFromSamples, textToSpeech } = require('./tts-voice');
const { sendTextAsVoice } = require('./send-voice');

module.exports = {
  createVoiceFromSamples,
  textToSpeech,
  sendTextAsVoice,
};
