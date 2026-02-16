const { getBatchDelayRange, getBatchSendTimeoutMs } = require('./config');
const { openChatAndSendMessage: openChatAndSendMessageBrowser } = require('./send-via-browser');

/**
 * Random delay between minMs and maxMs (inclusive).
 * @param {number} minMs
 * @param {number} maxMs
 * @returns {number}
 */
function randomDelayMs(minMs, maxMs) {
  if (minMs >= maxMs) return minMs;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a promise with a timeout; rejects with Error('Send timeout') if not settled in time.
 * @param {Promise} promise
 * @param {number} ms
 * @returns {Promise}
 */
function withTimeout(promise, ms) {
  if (ms <= 0) return promise;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Send timeout after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

/**
 * Ensure Brazilian-style number has 13 digits by inserting '9' between 4th and 5th digit as needed.
 * (55 + 2-digit area + 9 + 8 digits = 13; missing 9s are inserted after the area code.)
 * @param {string} digits - Digits only
 * @returns {string} - Same or extended to 13 digits
 */
function ensureBrazilian13Digits(digits) {
  let d = digits;
  while (d.length < 13 && d.length >= 4) {
    d = d.slice(0, 4) + '9' + d.slice(4);
  }
  return d;
}

/**
 * Normalize contact and optionally detect if it was fixed (for resend logic).
 * @param {string} contact - Phone with or without @c.us
 * @returns {{ normalized: string, wasFixed: boolean }}
 */
function normalizeContactWithFix(contact) {
  const trimmed = String(contact).trim().replace(/\D/g, '');
  if (!trimmed) return { normalized: contact, wasFixed: false };
  if (trimmed.includes('@')) return { normalized: contact, wasFixed: false };
  const hadWrongLength = trimmed.length < 13 && trimmed.length >= 4;
  const digits = ensureBrazilian13Digits(trimmed);
  const normalized = `${digits}@c.us`;
  return { normalized, wasFixed: hadWrongLength };
}

/**
 * Normalize contact to WhatsApp ID (e.g. "5511999999999" or "5511999999999@c.us" -> "5511999999999@c.us").
 * Numbers with &lt; 13 digits get a '9' inserted between 4th and 5th digit (Brazilian mobile format).
 * @param {string} contact - Phone with or without @c.us
 * @returns {string}
 */
function normalizeContactId(contact) {
  return normalizeContactWithFix(contact).normalized;
}

/** Default delay (ms) after send before verifying last message (allow WhatsApp to persist). */
const VERIFY_DELAY_MS = 2000;

/** Default max reattempts when verification fails (send succeeded but last message doesn't match). */
const DEFAULT_MAX_VERIFY_RETRIES = 2;

/**
 * Normalize contactId to digits-only prefix for matching (e.g. "5511999999999@c.us" -> "5511999999999").
 * @param {string} contactId
 * @returns {string}
 */
function contactDigits(contactId) {
  return String(contactId).replace(/@.*$/, '').replace(/\D/g, '');
}

/**
 * Resolve chat ID to the format required by WhatsApp (LID when needed).
 * Avoids "No LID for user" when sending to numbers that require LID (Lexical ID).
 * Tries: existing chat by number (often has LID) -> getContactLidAndPhone (lid then pn) -> getNumberId -> original.
 * @param {Client} client - whatsapp-web.js Client (must be ready)
 * @param {string} contactId - e.g. "5511999999999@c.us"
 * @returns {Promise<string>} - contactId to use for sendMessage/getChatById (lid or pn or original)
 */
async function resolveChatId(client, contactId) {
  const digits = contactDigits(contactId);

  // 1) If we have getChats, find an existing chat for this number; its id may already be LID
  if (typeof client.getChats === 'function') {
    try {
      const chats = await client.getChats();
      const match = chats.find((c) => {
        if (!c || !c.id) return false;
        const id = typeof c.id === 'string' ? c.id : c.id._serialized;
        if (!id) return false;
        const chatDigits = id.replace(/@.*$/, '').replace(/\D/g, '');
        return chatDigits === digits || id === contactId;
      });
      if (match) {
        const id = typeof match.id === 'string' ? match.id : match.id._serialized;
        if (id) return id;
      }
    } catch (_) {}
  }

  // 2) getContactLidAndPhone returns { lid, pn }; prefer lid for sendMessage (may throw for some contacts)
  if (typeof client.getContactLidAndPhone === 'function') {
    try {
      const result = await client.getContactLidAndPhone([contactId]);
      if (Array.isArray(result) && result[0]) {
        const { lid, pn } = result[0];
        if (lid) return lid;
        if (pn) return pn;
      }
    } catch (_) {}
  }

  // 3) getNumberId can return the canonical ID (sometimes LID)
  if (typeof client.getNumberId === 'function') {
    try {
      const wid = await client.getNumberId(contactId);
      if (wid && typeof wid === 'object' && wid._serialized) return wid._serialized;
      if (typeof wid === 'string') return wid;
    } catch (_) {}
  }

  return contactId;
}

/** True if the error message indicates "No LID for user" (WhatsApp LID requirement). */
function isNoLidError(err) {
  const msg = err && (err.message || String(err));
  return typeof msg === 'string' && (msg.includes('No LID for user') || msg.includes('LID for user'));
}

/**
 * Get the body of the last message we sent in a chat, or null if none or error.
 * Uses client.getChatById and chat.fetchMessages({ fromMe: true, limit }) and takes the latest.
 * @param {Client} client - whatsapp-web.js Client (must be ready)
 * @param {string} contactId - WhatsApp id e.g. "5511999999999@c.us"
 * @param {number} [limit] - Max messages to fetch from us (default 30)
 * @returns {Promise<string|null>} - Body of our last message, or null
 */
async function getLastMessageFromMe(client, contactId, limit = 30) {
  const withDate = await getLastMessageFromMeWithDate(client, contactId, limit);
  return withDate ? withDate.body : null;
}

/**
 * Get the last message we sent in a chat with its timestamp, or null if none or error.
 * @param {Client} client - whatsapp-web.js Client (must be ready)
 * @param {string} contactId - WhatsApp id e.g. "5511999999999@c.us"
 * @param {number} [limit] - Max messages to fetch from us (default 30)
 * @returns {Promise<{ body: string, timestamp: number }|null>} - timestamp is Unix seconds
 */
async function getLastMessageFromMeWithDate(client, contactId, limit = 30) {
  try {
    const chat = await client.getChatById(contactId);
    const messages = await chat.fetchMessages({ fromMe: true, limit });
    if (!Array.isArray(messages) || messages.length === 0) return null;
    const last = messages[messages.length - 1];
    if (!last) return null;
    const body = typeof last.body === 'string' ? last.body : '';
    const timestamp = typeof last.timestamp === 'number' ? last.timestamp : 0;
    return { body, timestamp };
  } catch (_) {
    return null;
  }
}

/** Return true if the Unix timestamp (seconds) falls on today (local date). */
function isTodayUnix(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return false;
  const d = new Date(unixSeconds * 1000);
  const today = new Date();
  return d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
}

/**
 * Send one message by opening the chat via WhatsApp Web send URL in a NEW tab and simulating type + Enter.
 * Uses client.pupBrowser (new tab) so the main WhatsApp Web page is never navigated, avoiding
 * "Execution context was destroyed" and duplicate ready events.
 * @param {Client} client - whatsapp-web.js Client (must have pupBrowser)
 * @param {string} contactId - e.g. "5511999999999@c.us"
 * @param {string} message - Full message text (including name)
 * @param {number} sendTimeoutMs - Used as navigation/send timeout
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendViaBrowser(client, contactId, message, sendTimeoutMs) {
  if (!client.pupBrowser) return { success: false, error: 'No browser (pupBrowser) available' };
  const digits = contactDigits(contactId);
  const result = await openChatAndSendMessageBrowser(client.pupBrowser, digits, message, {
    timeoutMs: sendTimeoutMs || 60000,
  });
  return result;
}

/**
 * Send one message without verification (used when skipVerify is true).
 * Resolves LID when needed to avoid "No LID for user". Retries with @lid format if that error occurs.
 * @param {Client} client
 * @param {string} contactId
 * @param {string} message
 * @param {number} sendTimeoutMs
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendOnce(client, contactId, message, sendTimeoutMs) {
  let chatId = await resolveChatId(client, contactId);
  try {
    await withTimeout(client.sendMessage(chatId, message), sendTimeoutMs);
    return { success: true };
  } catch (err) {
    if (isNoLidError(err) && contactId.endsWith('@c.us')) {
      const lidId = `${contactDigits(contactId)}@lid`;
      if (lidId !== chatId) {
        try {
          await withTimeout(client.sendMessage(lidId, message), sendTimeoutMs);
          return { success: true };
        } catch (err2) {
          return { success: false, error: err2 && (err2.message || String(err2)) };
        }
      }
    }
    return { success: false, error: err && (err.message || String(err)) };
  }
}

/**
 * Send one message and optionally verify it appears as our last message; reattempt if not.
 * Can optionally check first: if last message in chat already matches, skip send and report alreadySent.
 * @param {Client} client
 * @param {string} contactId
 * @param {string} message
 * @param {object} opts - { sendTimeoutMs, verifyDelayMs, maxVerifyRetries, checkAlreadySent, onStep }
 * @param {function(object): void} [opts.onStep] - Called with { type, contactId, attempt?, success?, error?, reason?, lastBody?, alreadySent? } for verbose logging
 * @returns {Promise<{ success: boolean, error?: string, retried?: number, alreadySent?: boolean }>}
 */
async function sendAndVerify(client, contactId, message, opts = {}) {
  const sendTimeoutMs = opts.sendTimeoutMs ?? getBatchSendTimeoutMs();
  const verifyDelayMs = opts.verifyDelayMs ?? VERIFY_DELAY_MS;
  const maxVerifyRetries = opts.maxVerifyRetries ?? DEFAULT_MAX_VERIFY_RETRIES;
  const checkAlreadySent = opts.checkAlreadySent !== false;
  const onStep = opts.onStep || (() => {});

  let chatId = await resolveChatId(client, contactId);
  const doSend = (id) => withTimeout(client.sendMessage(id, message), sendTimeoutMs);

  if (checkAlreadySent) {
    const lastBody = await getLastMessageFromMe(client, chatId);
    if (lastBody === message) {
      onStep({
        type: 'already_sent',
        contactId,
        reason: 'Last message in chat already matches; skipping send.',
      });
      return { success: true, alreadySent: true };
    }
  }

  let lastError;
  for (let attempt = 0; attempt <= maxVerifyRetries; attempt++) {
    onStep({ type: 'attempt_start', contactId, attempt, maxAttempts: maxVerifyRetries + 1 });

    try {
      await doSend(chatId);
      onStep({ type: 'send_ok', contactId, attempt });
    } catch (err) {
      lastError = err && (err.message || String(err));
      if (isNoLidError(err) && contactId.endsWith('@c.us')) {
        const lidId = `${contactDigits(contactId)}@lid`;
        if (lidId !== chatId) {
          try {
            await doSend(lidId);
            chatId = lidId;
            lastError = null;
            onStep({ type: 'send_ok', contactId, attempt });
          } catch (err2) {
            lastError = err2 && (err2.message || String(err2));
          }
        }
      }
      if (lastError) {
        onStep({ type: 'send_fail', contactId, attempt, error: lastError });
        if (attempt === maxVerifyRetries) return { success: false, error: lastError };
        await sleep(verifyDelayMs);
        onStep({ type: 'reattempt', contactId, nextAttempt: attempt + 1 });
        continue;
      }
    }

    await sleep(verifyDelayMs);
    onStep({ type: 'verify_start', contactId, attempt });
    const lastBody = await getLastMessageFromMe(client, chatId);
    if (lastBody === message) {
      onStep({ type: 'verify_match', contactId, attempt });
      return { success: true, retried: attempt };
    }
    lastError =
      lastBody == null
        ? 'Verification failed: no last message from us'
        : `Verification failed: last message does not match (got ${lastBody.length} chars)`;
    const reason =
      lastBody == null
        ? 'No message from us in chat'
        : `Last message does not match (expected ${message.length} chars, got ${lastBody.length})`;
    onStep({
      type: 'verify_fail',
      contactId,
      attempt,
      reason,
      lastBodySnippet: lastBody ? lastBody.slice(0, 50) + (lastBody.length > 50 ? '…' : '') : null,
    });
    if (attempt === maxVerifyRetries) {
      onStep({ type: 'done', contactId, success: false, error: lastError });
      return { success: false, error: lastError };
    }
    onStep({ type: 'reattempt', contactId, nextAttempt: attempt + 1 });
  }

  onStep({ type: 'done', contactId, success: false, error: lastError });
  return { success: false, error: lastError };
}

/**
 * Send messages to multiple contacts as a batch, with random delay before each send
 * to reduce the risk of being flagged as spam. All messages are sent through the same
 * client (same browser session); do not create a new client per message.
 * After each send, the client is used to verify the last message in that chat; if it
 * does not match the sent text, the send is reattempted up to maxVerifyRetries times.
 * @param {Client} client - whatsapp-web.js Client (must be ready); single session for all sends
 * @param {Array<{ contact: string, message: string }>} items - List of { contact, message }
 * @param {object} [options]
 * @param {number} [options.minDelayMs] - Min delay before each message (default from config)
 * @param {number} [options.maxDelayMs] - Max delay before each message (default from config)
 * @param {number} [options.sendTimeoutMs] - Max wait per send (0 = no timeout). Default 60000 (60s) so a hung send doesn't block the batch.
 * @param {number} [options.verifyDelayMs] - Delay after send before checking last message (default 2000)
 * @param {number} [options.maxVerifyRetries] - Reattempts when verification fails (default 2)
 * @param {boolean} [options.skipVerify] - If true, send only (no verify/reattempt). For tests or when verification is not needed.
 * @param {boolean} [options.useBrowserSend] - If true, send by navigating to send URL and simulating type+Enter (avoids "número desconhecido").
 * @param {boolean} [options.skipIfEverSent] - If true (default), skip contact when we have ever sent any message in that chat (only send to users who have not received previously).
 * @param {boolean} [options.skipIfSentToday] - When skipIfEverSent is false: if true (default), skip when our last message was sent today.
 * @param {function(number, number, string): void} [options.onProgress] - Called as (currentIndex, total, contactId) before each send
 * @param {function(object): void} [options.onStep] - Called with step details for each send/verify (type, contactId, attempt?, error?, reason?, etc.) for verbose logging
 * @returns {Promise<{ sent: number, failed: number, results: Array<{ contact: string, success: boolean, error?: string, retried?: number, alreadySent?: boolean, skippedSameDay?: boolean, skippedAlreadyReceived?: boolean }> }>}
 */
async function runBatch(client, items, options = {}) {
  const range = getBatchDelayRange();
  const minDelayMs = options.minDelayMs ?? range.minMs;
  const maxDelayMs = options.maxDelayMs ?? range.maxMs;
  const sendTimeoutMs = options.sendTimeoutMs ?? getBatchSendTimeoutMs();
  const onProgress = options.onProgress || (() => {});
  const onStep = options.onStep || (() => {});
  const skipVerify = options.skipVerify === true;
  const useBrowserSend = options.useBrowserSend === true;
  const skipIfEverSent = options.skipIfEverSent !== false;
  const skipIfSentToday = options.skipIfSentToday !== false;

  const results = [];
  let sent = 0;
  let failed = 0;
  const total = items.length;

  for (let i = 0; i < total; i++) {
    const { contact, message } = items[i];
    const contactId = normalizeContactId(contact);

    const delay = randomDelayMs(minDelayMs, maxDelayMs);
    await sleep(delay);

    onProgress(i + 1, total, contactId);
    onStep({ type: 'contact_start', contactId, current: i + 1, total, delayMs: delay });

    let resolvedId;
    if (skipIfEverSent || skipIfSentToday) {
      resolvedId = await resolveChatId(client, contactId);
    }

    if (skipIfEverSent) {
      const lastFromMe = await getLastMessageFromMe(client, resolvedId);
      if (lastFromMe != null && lastFromMe !== '') {
        onStep({
          type: 'already_sent',
          contactId,
          reason: 'Contato já recebeu mensagem anteriormente; ignorado (apenas quem ainda não recebeu).',
        });
        results.push({ contact: contactId, success: true, skippedAlreadyReceived: true });
        continue;
      }
    } else if (skipIfSentToday) {
      const lastFromMe = await getLastMessageFromMeWithDate(client, resolvedId);
      if (lastFromMe && isTodayUnix(lastFromMe.timestamp)) {
        onStep({
          type: 'already_sent',
          contactId,
          reason: 'Última mensagem já enviada hoje; ignorado (um envio por contato por dia).',
        });
        results.push({ contact: contactId, success: true, skippedSameDay: true });
        continue;
      }
    }

    let result;
    if (useBrowserSend) {
      onStep({ type: 'attempt_start', contactId, attempt: 0, maxAttempts: 1 });
      result = await sendViaBrowser(client, contactId, message, sendTimeoutMs);
      if (result.success) {
        onStep({ type: 'send_ok', contactId, attempt: 0 });
        await sleep(2500);
      } else {
        onStep({ type: 'send_fail', contactId, attempt: 0, error: result.error });
      }
    } else if (skipVerify) {
      result = await sendOnce(client, contactId, message, sendTimeoutMs);
    } else {
      result = await sendAndVerify(client, contactId, message, {
        sendTimeoutMs,
        verifyDelayMs: options.verifyDelayMs,
        maxVerifyRetries: options.maxVerifyRetries,
        onStep,
      });
    }

    if (result.success) {
      results.push({
        contact: contactId,
        success: true,
        ...(result.retried != null && result.retried > 0 && { retried: result.retried }),
        ...(result.alreadySent && { alreadySent: true }),
      });
      sent++;
    } else {
      results.push({ contact: contactId, success: false, error: result.error });
      failed++;
    }
  }

  return { sent, failed, results };
}

module.exports = {
  randomDelayMs,
  sleep,
  withTimeout,
  ensureBrazilian13Digits,
  normalizeContactWithFix,
  normalizeContactId,
  contactDigits,
  resolveChatId,
  isNoLidError,
  getLastMessageFromMe,
  getLastMessageFromMeWithDate,
  isTodayUnix,
  sendViaBrowser,
  sendOnce,
  sendAndVerify,
  runBatch,
  VERIFY_DELAY_MS,
  DEFAULT_MAX_VERIFY_RETRIES,
};
