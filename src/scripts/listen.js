/**
 * Start the client and listen to messages in groups and private chats.
 * After sync, suggests next reply based on recent messages (and transcribes voice when needed).
 * Usage: npm run listen   [optional: RUN_BATCH=batch.json or --send-batch=batch.json]
 * Set ENABLE_REPLY_SUGGESTION=true and OPENAI_API_KEY in .env to enable suggestions.
 */
const path = require('path');
const { createClient } = require('../client');
const { attachListeners } = require('../listeners');
const { suggestReply } = require('../services/reply-suggestion');
const { createFirstContactAgent } = require('../services/first-contact-agent');
const { isFirstContactAgentEnabled } = require('../config');
const { runBatch } = require('../batch-sender');
const { loadBatchItems } = require('../batch-loader');
const {
  getBatchSendTimeoutMs,
  getBatchSkipIfEverSent,
  getBatchRequireOptIn,
  getBatchMaxPerRun,
  getBatchCooldown,
  getBatchHealthStopRules,
} = require('../config');

const headless = process.env.LISTEN_HEADLESS !== 'false' && process.env.LISTEN_HEADLESS !== '0';
const client = createClient({ headless });
const enableSuggestion = process.env.ENABLE_REPLY_SUGGESTION === 'true' || process.env.ENABLE_REPLY_SUGGESTION === '1';
const enableFirstContactAgent = isFirstContactAgentEnabled();
const firstContactAgent = enableFirstContactAgent ? createFirstContactAgent() : null;

const batchPathFromEnv = process.env.RUN_BATCH || '';
const batchPathFromArg = (process.argv.slice(2).find((a) => a.startsWith('--send-batch=')) || '').replace('--send-batch=', '');
const batchForce = process.env.RUN_BATCH_FORCE === 'true' || process.env.RUN_BATCH_FORCE === '1';
const batchPathToRun = batchPathFromArg || batchPathFromEnv || '';

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

client.on('ready', async () => {
  if (batchPathToRun) {
    try {
      const { items } = loadBatchItems(batchPathToRun);
      const useBrowserSend = process.env.BATCH_USE_BROWSER_SEND !== 'false';
      const skipIfEverSent = batchForce ? false : getBatchSkipIfEverSent();
      const skipIfSentToday = skipIfEverSent;
      const runLimit = Math.max(0, getBatchMaxPerRun());
      const cooldown = getBatchCooldown();
      const stopRules = getBatchHealthStopRules();
      console.log('[batch] Enviando lote:', batchPathToRun, '(' + items.length + ' contato(s)). Agente continua ligado.');
      function onStep(step) {
        const { type, contactId, reason, error } = step;
        if (type === 'contact_start') console.log('[batch]', step.current + '/' + step.total, contactId);
        if (type === 'send_ok' || type === 'verify_match') console.log('[batch] OK', contactId);
        if (type === 'send_fail' || type === 'verify_fail') console.log('[batch] Falha', contactId, error || reason);
        if (type === 'already_sent') console.log('[batch] Ignorado', contactId, reason);
      }
      const result = await runBatch(client, items, {
        sendTimeoutMs: getBatchSendTimeoutMs(),
        useBrowserSend,
        skipIfEverSent,
        skipIfSentToday,
        checkAlreadySent: !batchForce,
        requireOptIn: getBatchRequireOptIn(),
        maxPerRun: runLimit,
        cooldownEvery: cooldown.every,
        cooldownMinMs: cooldown.minMs,
        cooldownMaxMs: cooldown.maxMs,
        stopFailRate: stopRules.failRate,
        stopMinAttempts: stopRules.minAttempts,
        stopBlockLikeCount: stopRules.blockLikeCount,
        onStep,
      });
      console.log('[batch] Concluído. Enviados:', result.sent, 'Falhas:', result.failed);
    } catch (err) {
      console.error('[batch] Erro ao enviar lote:', err.message);
    }
  }
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
