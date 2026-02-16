/**
 * Start the client and listen to messages in groups and private chats.
 * After sync, suggests next reply based on recent messages (and transcribes voice when needed).
 * Usage: npm run listen
 * Set ENABLE_REPLY_SUGGESTION=true and OPENAI_API_KEY in .env to enable suggestions.
 */
const { createClient } = require('../client');
const { attachListeners } = require('../listeners');
const { suggestReply } = require('../services/reply-suggestion');

const client = createClient({ headless: true });
const enableSuggestion = process.env.ENABLE_REPLY_SUGGESTION === 'true' || process.env.ENABLE_REPLY_SUGGESTION === '1';

function runSuggestionForChat(chat) {
  if (!enableSuggestion) return;
  suggestReply(chat)
    .then((suggestion) => {
      if (suggestion) console.log('[sugestão de resposta]', suggestion);
    })
    .catch((err) => console.error('[sugestão]', err.message));
}

attachListeners(client, {
  onMessage(msg) {
    const preview = msg.type === 'ptt' || msg.type === 'audio' ? '[áudio]' : (msg.body?.slice(0, 80) || '');
    console.log('[message]', msg.from, preview);
    msg.getChat().then(runSuggestionForChat).catch(() => {});
  },
  onPrivateMessage(msg) {
    console.log('[private]', msg.from, msg.body?.slice(0, 80) || (msg.type === 'ptt' ? '[áudio]' : ''));
  },
  onGroupMessage(msg) {
    console.log('[group]', msg.from, msg.body?.slice(0, 80) || (msg.type === 'ptt' ? '[áudio]' : ''));
  },
});

client.on('qr', (qr) => {
  console.log('QR received. Run "npm run session" first to authenticate this session.');
});

client.on('auth_failure', (msg) => {
  console.error('Auth failure:', msg);
  process.exit(1);
});

client.on('ready', () => {
  console.log('Listening to chats (groups and private). Press Ctrl+C to stop.');
  if (enableSuggestion) console.log('Reply suggestion enabled (based on recent messages + audio transcription).');
});

client.initialize().catch((err) => {
  console.error('Initialize failed:', err);
  process.exit(1);
});
