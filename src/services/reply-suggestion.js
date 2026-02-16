const { getOpenAiApiKey } = require('../config');
const { transcribeAudio } = require('./transcription');

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_LIMIT = 25;
const MAX_MESSAGE_LENGTH = 500;

/**
 * Normalizes a single WhatsApp message for the conversation context: text or transcribed audio.
 * @param {object} msg - whatsapp-web.js Message
 * @param {function} [transcribe] - async (buffer, mimetype) => text
 * @returns {Promise<{ fromMe: boolean, author?: string, content: string }|null>}
 */
async function normalizeMessage(msg, transcribe = transcribeAudio) {
  const fromMe = Boolean(msg.fromMe);
  let content = '';
  const author = msg.author || msg.from;

  if (msg.type === 'ptt' || msg.type === 'audio') {
    try {
      const media = await msg.downloadMedia();
      if (!media || !media.data) return null;
      const buffer = Buffer.from(media.data, 'base64');
      content = await transcribe(buffer, media.mimetype || 'audio/ogg');
      if (!content) return null;
    } catch (err) {
      console.error('[reply-suggestion] transcription failed:', err.message);
      content = '[áudio não transcrito]';
    }
  } else {
    content = typeof msg.body === 'string' ? msg.body.trim() : '';
  }

  if (!content) return null;
  if (content.length > MAX_MESSAGE_LENGTH) content = content.slice(0, MAX_MESSAGE_LENGTH) + '…';

  return { fromMe, author, content };
}

/**
 * Fetches recent messages from a chat and builds a conversation thread (with audio transcribed).
 * @param {object} chat - whatsapp-web.js Chat (from msg.getChat() or client.getChatById)
 * @param {number} [limit] - Max messages to fetch
 * @param {function} [transcribe] - async (buffer, mimetype) => text
 * @returns {Promise<Array<{ role: 'user'|'assistant', content: string }>>}
 */
async function getConversationThread(chat, limit = DEFAULT_LIMIT, transcribe = transcribeAudio) {
  const raw = await chat.fetchMessages({ limit });
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const normalized = [];
  for (const msg of raw) {
    const n = await normalizeMessage(msg, transcribe);
    if (!n) continue;
    normalized.push(n);
  }

  const thread = [];
  for (const n of normalized) {
    const label = n.fromMe ? 'Eu' : (n.author ? `Contato (${n.author})` : 'Contato');
    const content = `${label}: ${n.content}`;
    thread.push({
      role: n.fromMe ? 'assistant' : 'user',
      content,
    });
  }
  return thread;
}

/**
 * Suggests the next reply based on recent messages (and transcribed voice messages).
 * Requires OPENAI_API_KEY. Fetches recent messages from the chat, transcribes any voice messages, then asks the model for a short suggestion.
 * @param {object} chat - whatsapp-web.js Chat
 * @param {object} [options]
 * @param {number} [options.limit] - Max recent messages to consider (default 25)
 * @param {string} [options.model] - OpenAI model (default gpt-4o-mini)
 * @returns {Promise<string>} - Suggested reply text (plain string, no quotes)
 */
async function suggestReply(chat, options = {}) {
  getOpenAiApiKey(); // throw early if missing

  const { limit = DEFAULT_LIMIT, model = DEFAULT_MODEL } = options;
  const thread = await getConversationThread(chat, limit);
  if (thread.length === 0) {
    return 'Não há mensagens recentes para sugerir uma resposta.';
  }

  const systemPrompt = `Você é um assistente que sugere a próxima resposta em uma conversa de WhatsApp.
Com base nas últimas mensagens (incluindo transcrições de áudio quando indicado), sugira UMA resposta curta e natural em português.
Responda apenas o texto da sugestão, sem aspas nem explicações.`;

  const userContent = thread.map((m) => m.content).join('\n');

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getOpenAiApiKey()}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: 150,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  const text = choice && choice.message && choice.message.content;
  return typeof text === 'string' ? text.trim() : '';
}

module.exports = {
  suggestReply,
  getConversationThread,
  normalizeMessage,
};
