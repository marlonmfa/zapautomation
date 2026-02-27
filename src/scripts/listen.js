/**
 * Start the client and listen to messages in groups and private chats.
 * After sync, suggests next reply based on recent messages (and transcribes voice when needed).
 * Usage: npm run listen
 * Set ENABLE_REPLY_SUGGESTION=true and OPENAI_API_KEY in .env to enable suggestions.
 */
const { createClient } = require('../client');
const { attachListeners } = require('../listeners');
const { suggestReply } = require('../services/reply-suggestion');
const { createFirstContactAgent } = require('../services/first-contact-agent');
const { isFirstContactAgentEnabled } = require('../config');

const client = createClient({ headless: true });
const enableSuggestion = process.env.ENABLE_REPLY_SUGGESTION === 'true' || process.env.ENABLE_REPLY_SUGGESTION === '1';
const enableFirstContactAgent = isFirstContactAgentEnabled();
const firstContactAgent = enableFirstContactAgent ? createFirstContactAgent() : null;

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
    if (enableFirstContactAgent && firstContactAgent) {
      firstContactAgent.handleIncomingMessage(client, msg)
        .then((decision) => {
          if (!decision || decision.action === 'ignore') return;
          console.log('[first-contact]', JSON.stringify({
            contactId: decision.contactId,
            action: decision.action,
            intent: decision.intent,
            confidence: Number.isFinite(decision.confidence) ? Number(decision.confidence.toFixed(2)) : 0,
            state: decision.state,
            reason: decision.reason,
          }));
        })
        .catch((err) => {
          console.error('[first-contact] erro:', err.message);
        });
    }
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
  if (enableFirstContactAgent) {
    console.log('First-contact auto attendant enabled (automatic replies for private chats with confidence/safety gate).');
  }
});

client.initialize().catch((err) => {
  console.error('Initialize failed:', err);
  process.exit(1);
});
