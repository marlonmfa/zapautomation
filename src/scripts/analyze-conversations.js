/**
 * Analyze all contacts from a batch file: fetch chat history, extract context,
 * and build a table with next-step suggestions for each conversation.
 *
 * Usage: node src/scripts/analyze-conversations.js <batch.json|número> [output.csv] [--open]
 * Example: node src/scripts/analyze-conversations.js <número> relatorio.csv --open
 *          node src/scripts/analyze-conversations.js batch-imoveis-clientes.json relatorio.csv
 *
 * --open         Abre o navegador visível (Puppeteer headless: false)
 * --debug        Log de debug para diagnóstico de chats não encontrados
 * --extract-only Apenas extrai as mensagens (conversa completa), sem análise/tabela/next step
 *
 * Requires OPENAI_API_KEY in .env for AI analysis. Without it, outputs raw message summary.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('../client');
const { resolveChatId, ensureBrazilian13Digits } = require('../batch-sender');
const { toBrazilWhatsApp } = require('../batch-lucas-utils');

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const MSG_LIMIT = 50;
/** Large limit so fetchMessages loads all history (Infinity is lost in Puppeteer JSON serialization). */
const MSG_LIMIT_SINGLE = 10000;
const MAX_MSG_LEN = 400;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractNameFromMessage(message) {
  const m = String(message || '').match(/Opa\s+([^,]+)/i);
  return m ? m[1].trim() : '';
}

/**
 * Match two phone numbers (Brazilian format).
 */
function phonesMatch(target, contactRaw) {
  const norm = (s) => String(s || '').replace(/\D/g, '');
  const t = ensureBrazilian13Digits(norm(target));
  const r = norm(contactRaw || '');
  const c = ensureBrazilian13Digits(r.startsWith('55') ? r : '55' + r);
  if (t.length < 10 || c.length < 10) return false;
  return t === c || (c.length >= 10 && t.endsWith(c)) || (t.length >= 10 && c.endsWith(t));
}

/**
 * Find chat by phone number, matching both @c.us and LID chats.
 * Includes archived chats. Tries chat.id first, then getContact() for LID chats.
 */
async function findChatByPhone(client, targetDigits) {
  const target = ensureBrazilian13Digits(String(targetDigits || '').replace(/\D/g, ''));
  if (target.length < 10) return null;

  const matchId = (id) => {
    if (!id) return false;
    const s = typeof id === 'string' ? id : id._serialized || '';
    const digits = s.replace(/@.*$/, '').replace(/\D/g, '');
    return phonesMatch(target, digits);
  };

  try {
    let chats = await client.getChats();
    for (const chat of chats) {
      if (chat.isGroup) continue;
      if (matchId(chat.id)) return chat;
      try {
        const contact = await chat.getContact();
        if (!contact) continue;
        const raw = contact.number || contact.id?._serialized || contact.id || '';
        if (phonesMatch(target, raw)) return chat;
      } catch (_) {}
    }

    const archivedIds = await client.pupPage.evaluate(() => {
      try {
        const out = [];
        const all = window.Store?.Chat?.getModelsArray?.() || [];
        for (const c of all) {
          if (c.archive && !c.id?._serialized?.includes('@g.us')) {
            const id = c.id?._serialized || c.id;
            if (id) out.push(id);
          }
        }
        return out;
      } catch {
        return [];
      }
    }).catch(() => []);

    for (const chatId of archivedIds) {
      if (!chatId) continue;
      const digits = String(chatId).replace(/@.*$/, '').replace(/\D/g, '');
      if (phonesMatch(target, digits)) {
        try {
          const chat = await client.getChatById(chatId);
          if (chat) return chat;
        } catch (_) {}
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Close all browser tabs except the one used by the client (avoids multiple WhatsApp tabs).
 */
async function closeOtherTabs(client) {
  try {
    const browser = client.pupBrowser;
    const mainPage = client.pupPage;
    if (!browser || !mainPage) return;
    const pages = await browser.pages();
    if (!pages || pages.length <= 1) return;
    for (const p of pages) {
      if (p !== mainPage && !p.isClosed()) await p.close().catch(() => {});
    }
  } catch (_) {}
}

/**
 * Open the chat by selecting it in the sidebar (same tab). Returns true if done, false to fallback.
 */
async function openChatByClickingSidebar(client, chatId, debug) {
  const log = (msg) => debug && process.stdout.write(`[DEBUG] ${msg}\n`);
  const digitsNorm = String(chatId).replace(/@.*$/, '').replace(/\D/g, '').slice(-11);
  try {
    const clicked = await client.pupPage.evaluate(async (chatId, digitsNorm) => {
      const chat = await window.WWebJS?.getChat?.(chatId, { getAsModel: false });
      if (!chat) return false;
      const pane = document.querySelector('#pane-side');
      if (!pane) return false;
      const id = chat.id?._serialized || (typeof chat.id === 'string' ? chat.id : '');
      const norm = (s) => String(s || '').replace(/\D/g, '').slice(-11);
      const idNorm = norm(id);
      const sel = pane.querySelector(`[data-id="${id}"]`);
      if (sel) {
        sel.click();
        return true;
      }
      const rows = pane.querySelectorAll('[role="listitem"], [role="row"], div[data-testid="cell-frame-container"], [data-id]');
      for (const row of rows) {
        const dataId = row.getAttribute?.('data-id');
        if (!dataId) continue;
        if (dataId === id || norm(dataId) === idNorm || (digitsNorm && norm(dataId) === digitsNorm)) {
          row.click();
          return true;
        }
      }
      return false;
    }, chatId, digitsNorm);
    log(`openChatByClickingSidebar: ${clicked}`);
    return !!clicked;
  } catch (e) {
    if (debug) process.stdout.write(`[DEBUG] openChatByClickingSidebar: ${e.message}\n`);
    return false;
  }
}

/**
 * Open chat, scroll to top and repeatedly click "load older messages" so the phone sends more to Web.
 * Only after that we read from the Store. Uses sidebar click to avoid opening extra tabs.
 */
async function openChatAndLoadAllMessages(client, chatId, limit, debug) {
  const log = (msg) => debug && process.stdout.write(`[DEBUG] ${msg}\n`);
  if (limit < 500) return [];
  try {
    await sleep(80);
    await closeOtherTabs(client);
    let openedBySidebar = await openChatByClickingSidebar(client, chatId, debug);
    if (!openedBySidebar) {
      await sleep(20);
      await client.pupPage.evaluate(() => {
        const pane = document.querySelector('#pane-side');
        if (pane) {
          pane.scrollTop = 0;
          pane.scrollBy(0, 300);
        }
      }).catch(() => {});
      await sleep(20);
      openedBySidebar = await openChatByClickingSidebar(client, chatId, debug);
    }
    // Reliability fallback: force-open selected chat when sidebar match fails.
    if (!openedBySidebar && typeof client.interface?.openChatWindow === 'function') {
      log(`sidebar failed, forcing chat open: ${chatId}`);
      await client.interface.openChatWindow(chatId).catch(() => {});
      await sleep(80);
      await closeOtherTabs(client);
    }
    if (openedBySidebar) await sleep(80);
    const page = client.pupPage;
    const mainHandle = await page.$('#main').catch(() => null);
    if (mainHandle) {
      await mainHandle.click({ offset: { x: 100, y: 200 } }).catch(() => {});
      await mainHandle.dispose().catch(() => {});
    }
    if (typeof page.setDefaultTimeout === 'function') page.setDefaultTimeout(300000);
    for (let k = 0; k < 8; k++) {
      await page.keyboard.press('PageUp');
      await sleep(10);
    }
    await sleep(80);
    const digitsNorm = String(chatId).replace(/@.*$/, '').replace(/\D/g, '').slice(-11);
    const result = await client.pupPage.evaluate(async (chatId, digitsNorm, maxClickRounds, waitAfterClickMs, maxLoadIterations, noButtonStopRounds, maxMsgLen) => {
      let chat = await window.WWebJS?.getChat?.(chatId, { getAsModel: false });
      if (!chat || !chat.msgs) {
        const norm = (s) => String(s || '').replace(/\D/g, '').slice(-11);
        const all = window.Store?.Chat?.getModelsArray?.() || [];
        for (const c of all) {
          if (c.id?.user && norm(c.id.user) === digitsNorm) { chat = c; break; }
          const sid = c.id?._serialized || (typeof c.id === 'string' ? c.id : '');
          if (norm(sid) === digitsNorm) { chat = c; break; }
        }
      }
      if (!chat || !chat.msgs) return { storeCount: 0, clicks: 0, reason: 'no-chat', messages: [] };
      const msgFilter = (m) => !m.isNotification;

      const main = document.querySelector('#main');
      if (!main) return { storeCount: 0, clicks: 0, reason: 'no-main', messages: [] };

      function findScrollable() {
        const tryEl = (el) => el && el.scrollHeight > el.clientHeight && el.scrollHeight > 400 ? el : null;
        const sel = [
          () => main.querySelector('[role="application"]'),
          () => main.querySelector('div[style*="overflow"]'),
          () => main.querySelector('div[data-tab="1"]'),
          () => main.querySelector('.copyable-area'),
          () => main.querySelector('div[role="list"]')?.parentElement,
        ];
        for (const fn of sel) {
          const el = tryEl(fn());
          if (el) return el;
        }
        for (const el of main.querySelectorAll('div')) {
          const s = window.getComputedStyle(el);
          const oy = s.overflowY || s.overflow;
          if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight && el.scrollHeight > 500)
            return el;
        }
        return main;
      }
      const scrollable = findScrollable();

      const loadMorePhrases = [
        'clique neste aviso para carregar mensagens mais antigas do seu celular',
        'clique neste aviso',
        'sincronizando mensagens mais antigas',
        'clique para ver o progresso',
        'carregar mensagens mais antigas do seu celular',
        'older messages', 'mensagens antigas', 'from your phone', 'do seu telefone', 'do seu celular',
        'carregar mensagens mais antigas', 'carregar', 'load more', 'click here', 'clique aqui',
        'telefone', 'phone', 'anteriores', 'get older', 'clique para', 'click to', 'sincronizando',
      ];

      function findLoadMoreButton() {
        const walk = (root) => {
          const t = (root.textContent || '').toLowerCase().trim();
          if (t.length < 15 || t.length > 300) return null;
          if (!loadMorePhrases.some((p) => t.includes(p))) return null;
          for (const child of root.children || []) {
            const found = walk(child);
            if (found) return found;
          }
          return root;
        };
        const selectors = [
          'button', 'a', '[role="button"]', 'div[role="button"]',
          'span[class]', 'div[class]', '[data-testid]', '.copyable-text', '[class*="copyable"]',
          '[role="listitem"]', 'div',
        ];
        for (const sel of selectors) {
          try {
            const nodes = main.querySelectorAll(sel);
            for (const el of nodes) {
              const found = walk(el);
              if (found) return found;
            }
          } catch (_) {}
        }
        const all = main.getElementsByTagName('*');
        for (let i = all.length - 1; i >= 0; i--) {
          const el = all[i];
          const t = (el.textContent || '').toLowerCase().trim();
          if (t.length >= 20 && t.length <= 250 && loadMorePhrases.some((p) => t.includes(p))) {
            if (!el.querySelector('button, a, [role="button"]')) return el;
          }
        }
        return null;
      }

      async function scrollToTopAndUp(steps, stepPx, delayMs) {
        scrollable.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < steps; i++) {
          scrollable.scrollBy(0, -stepPx);
          if (scrollable.scrollTop <= 0) scrollable.scrollTop = 0;
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      let clicks = 0;
      let stableRounds = 0;
      let lastStoreCount = chat.msgs.getModelsArray().filter(msgFilter).length;

      // Keep going up until there is no "older messages" button AND store size stops growing.
      for (let round = 0; round < maxClickRounds; round++) {
        await scrollToTopAndUp(16, 450, 0);
        await new Promise((r) => setTimeout(r, 40));

        let grewThisRound = false;
        const btn = findLoadMoreButton();
        if (btn) {
          try {
            btn.scrollIntoView({ block: 'center', behavior: 'auto' });
            await new Promise((r) => setTimeout(r, 60));
            btn.click();
            clicks++;
            await new Promise((r) => setTimeout(r, waitAfterClickMs));
          } catch (_) {}
        }

        // After each round, aggressively try to load earlier messages from Store.
        let localIterations = 0;
        while (localIterations < maxLoadIterations) {
          const loaded = await window.Store.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs);
          if (!loaded || loaded.length === 0) break;
          localIterations++;
          const newLen = chat.msgs.getModelsArray().filter(msgFilter).length;
          if (newLen > lastStoreCount) {
            lastStoreCount = newLen;
            grewThisRound = true;
          }
          await new Promise((r) => setTimeout(r, 20));
        }

        const nowCount = chat.msgs.getModelsArray().filter(msgFilter).length;
        if (nowCount > lastStoreCount) {
          lastStoreCount = nowCount;
          grewThisRound = true;
        }

        if (!btn && !grewThisRound) {
          stableRounds++;
        } else {
          stableRounds = 0;
        }

        if (stableRounds >= noButtonStopRounds) break;
      }

      const arr = chat.msgs.getModelsArray().filter(msgFilter);
      const messages = arr.map((m) => ({
        fromMe: Boolean(m.id?.fromMe ?? m.fromMe),
        body: String(m.body || m.text || '').slice(0, maxMsgLen),
        timestamp: m.t || m.timestamp || 0,
      })).filter((m) => (m.body || '').trim());
      return {
        storeCount: arr.length,
        clicks,
        reason: null,
        messages,
      };
    }, chatId, digitsNorm, 320, 450, 80, 20, MAX_MSG_LEN);
    log(`load done: ${result.storeCount} msgs, ${result.clicks} clicks (botão carregar do celular)${result.reason ? ' [' + result.reason + ']' : ''}`);
    await sleep(50);
    await closeOtherTabs(client);
    return result.messages || [];
  } catch (e) {
    log(`openChatAndLoadAllMessages: ${e.message}`);
    return [];
  }
}

/**
 * Read messages from the page Store (fallback when chat.fetchMessages returns 0).
 * Used after openChatAndLoadAllMessages so the Store is already hydrated.
 * Tries getChat(chatId) first, then finds chat by number in Store.Chat.getModelsArray().
 */
async function getMessagesFromStore(client, chatId, debug) {
  const log = (msg) => debug && process.stdout.write(`[DEBUG] ${msg}\n`);
  const digits = String(chatId).replace(/@.*$/, '').replace(/\D/g, '');
  const digitsNorm = digits.length >= 10 ? digits.slice(-11) : digits;
  try {
    const list = await client.pupPage.evaluate((chatId, digitsNorm, maxLen) => {
      const norm = (s) => String(s || '').replace(/\D/g, '');
      const match = (id) => id && norm(id).slice(-11) === digitsNorm;
      let chat = window.WWebJS?.getChat?.(chatId, { getAsModel: false });
      if (!chat || !chat.msgs) {
        const all = window.Store?.Chat?.getModelsArray?.() || [];
        for (const c of all) {
          if (c.id?.user && match(c.id.user)) {
            chat = c;
            break;
          }
          const sid = c.id?._serialized || (typeof c.id === 'string' ? c.id : '');
          if (match(sid)) {
            chat = c;
            break;
          }
        }
      }
      if (!chat || !chat.msgs) return [];
      const arr = chat.msgs.getModelsArray?.() || [];
      return arr
        .filter((m) => !m.isNotification)
        .map((m) => ({
          fromMe: Boolean(m.id?.fromMe ?? m.fromMe),
          body: String(m.body || m.text || '').slice(0, maxLen),
          timestamp: m.t || m.timestamp || 0,
        }))
        .filter((m) => (m.body || '').trim());
    }, chatId, digitsNorm, MAX_MSG_LEN);
    log(`getMessagesFromStore: ${Array.isArray(list) ? list.length : 0}`);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    log(`getMessagesFromStore: ${e.message}`);
    return [];
  }
}

async function fetchConversation(client, contactId, limit = MSG_LIMIT, debug = false) {
  const log = (msg) => debug && process.stdout.write(`[DEBUG] ${msg}\n`);
  try {
    const digits = String(contactId).replace(/@.*$/, '').replace(/\D/g, '');
    let chat = await findChatByPhone(client, digits);
    log(`findChatByPhone(${digits}): ${chat ? 'found ' + (chat.id?._serialized || chat.id) : 'null'}`);
    if (!chat) {
      const chatId = await resolveChatId(client, contactId);
      log(`resolveChatId -> ${chatId}`);
      chat = await client.getChatById(chatId);
      log(`getChatById ok: ${!!chat}`);
    }
    const chatIdSerialized = chat.id?._serialized || chat.id;
    const storeMessages = await openChatAndLoadAllMessages(client, chatIdSerialized, limit, debug);
    await sleep(120);
    if (limit >= 500) process.stdout.write('Coletando dados da conversa... ');
    let messages = await chat.fetchMessages({ limit });
    log(`fetchMessages: ${Array.isArray(messages) ? messages.length : 'non-array'}`);
    if (Array.isArray(messages)) {
      messages = messages
        .map((m) => ({
          fromMe: Boolean(m.fromMe),
          body: (m.body || '').slice(0, MAX_MSG_LEN),
          timestamp: m.timestamp,
        }))
        .filter((m) => m.body.trim());
    } else {
      messages = [];
    }
    if (messages.length === 0 && limit >= 500 && Array.isArray(storeMessages) && storeMessages.length > 0) {
      messages = storeMessages;
      log(`usando ${messages.length} msgs do Store (chat aberto)`);
    }
    if (messages.length === 0 && limit >= 500) {
      messages = await getMessagesFromStore(client, chatIdSerialized, debug);
    }
    if (limit >= 500) process.stdout.write(`${messages.length} mensagens.\n`);
    return messages;
  } catch (e) {
    log(`fetchConversation: ${e.message}`);
    return [];
  }
}

function formatThread(messages) {
  return messages
    .map((m) => (m.fromMe ? `Eu: ${m.body}` : `Cliente: ${m.body}`))
    .join('\n');
}

async function analyzeWithAI(thread, contactName) {
  try {
    const key = (process.env.OPENAI_API_KEY || '').trim();
    if (!key) return null;

    const res = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você analisa conversas de WhatsApp sobre imóveis. Analise a conversa INTEIRA e forneça:
1. CONTEXTO: resumo completo do que foi discutido - interesse do cliente, tipo de imóvel, preço mencionado, dúvidas, objeções, etapa atual da negociação.
2. PROXIMA_ETAPA: ação concreta e específica para este cliente (ex: enviar fotos do imóvel X, agendar visita para segunda, enviar proposta de R$ X, ligar para confirmar interesse, aguardar resposta sobre o valor, etc.)

Responda em português, de forma objetiva e acionável. Formato:
CONTEXTO: ...
PROXIMA_ETAPA: ...`,
          },
          {
            role: 'user',
            content: `Cliente: ${contactName}\n\nConversa:\n${thread}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.4,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const extractOnly = rawArgs.includes('--extract-only') || process.env.ANALYZE_EXTRACT_ONLY === '1';
  const args = rawArgs.filter((a) => a !== '--open' && a !== '--debug' && a !== '--extract-only');
  let items;
  let outPath;
  const numberArg = args.find((a) => a === '--number');
  const numberIdx = numberArg ? args.indexOf('--number') + 1 : -1;
  const singleNumber = numberIdx >= 0 && args[numberIdx] ? args[numberIdx] : null;
  const digitOnly = args[0] && /^\d+$/.test(String(args[0]).replace(/\D/g, '')) ? args[0] : null;

  if (singleNumber || digitOnly) {
    const num = (singleNumber || digitOnly || '').replace(/\D/g, '');
    if (!num || num.length < 10) {
      console.error('Usage: node analyze-conversations.js <número> [output.csv]');
      console.error('   ou: node analyze-conversations.js --number <número>');
      process.exit(1);
    }
    const raw = num.startsWith('55') ? num : '55' + num;
    const digits = ensureBrazilian13Digits(raw);
    items = [{ contact: digits, message: '' }];
    outPath = args.find((a) => a.endsWith('.csv')) || args[1];
  } else {
    const batchPath = args[0];
    outPath = args[1];
    if (!batchPath) {
      console.error('Usage: node analyze-conversations.js <batch.json> [output.csv]');
      console.error('   ou: node analyze-conversations.js <número> [output.csv]');
      process.exit(1);
    }
    const absolutePath = path.isAbsolute(batchPath) ? batchPath : path.join(process.cwd(), batchPath);
    if (!fs.existsSync(absolutePath)) {
      console.error('File not found:', absolutePath);
      process.exit(1);
    }
    try {
      items = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    } catch (e) {
      console.error('Invalid JSON:', e.message);
      process.exit(1);
    }
    if (!Array.isArray(items) || items.length === 0) {
      console.error('Batch must be a non-empty array of { contact, message }.');
      process.exit(1);
    }
  }

  console.log('--- Análise de Conversas ---');
  if (!extractOnly && !(process.env.OPENAI_API_KEY || '').trim()) {
    console.log('(Sem OPENAI_API_KEY: análise será resumo das mensagens. Configure para análise IA com próxima etapa.)');
  }
  const openBrowser = rawArgs.includes('--open') || process.env.ANALYZE_OPEN === '1';
  const headless = !openBrowser && process.env.ANALYZE_HEADLESS !== 'false';
  if (openBrowser) console.log('Abrindo guia do navegador (Puppeteer headless: false)...');
  console.log('Conectando ao WhatsApp...', headless ? '' : '(navegador visível)');
  const client = createClient({
    headless,
    puppeteer: {
      headless: headless ? true : false,
      timeout: 360000,
      protocolTimeout: 360000,
    },
  });
  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('auth_failure', (m) => reject(new Error('Auth failure: ' + m)));
    client.initialize().catch(reject);
  });
  await closeOtherTabs(client);
  console.log('Conectado. Analisando', items.length, 'contatos...\n');
  await sleep(120);

  const rows = [];
  const hasOpenAI = !extractOnly && !!(process.env.OPENAI_API_KEY || '').trim();
  const debug = process.env.DEBUG_ANALYZE === '1' || rawArgs.includes('--debug');

  for (let i = 0; i < items.length; i++) {
    const { contact, message } = items[i];
  await closeOtherTabs(client);
  const raw = toBrazilWhatsApp(contact);
  const digits = ensureBrazilian13Digits(raw);
  const contactId = digits + '@c.us';
    const name = extractNameFromMessage(message) || (items.length === 1 ? 'Cliente' : digits);

    const limit = items.length === 1 ? MSG_LIMIT_SINGLE : MSG_LIMIT;
    process.stdout.write(`[${i + 1}/${items.length}] ${name} (${digits})... `);
    if (items.length === 1 && limit >= 500) process.stdout.write('(abrindo chat e carregando histórico) ');
    const messages = await fetchConversation(client, contactId, limit, debug);
    const thread = formatThread(messages);
    let context = '';
    let proximaEtapa = '';

    if (!extractOnly && hasOpenAI && thread) {
      const analysis = await analyzeWithAI(thread, name);
      if (analysis) {
        const ctx = analysis.match(/CONTEXTO:?\s*(.+?)(?=PROXIMA_ETAPA|$)/is);
        const next = analysis.match(/PROXIMA_ETAPA:?\s*(.+?)$/is);
        context = ctx ? ctx[1].trim().replace(/\s+/g, ' ') : '';
        proximaEtapa = next ? next[1].trim().replace(/\s+/g, ' ') : '';
      }
    }
    if (!extractOnly && !context && thread) {
      const maxLen = items.length === 1 ? 800 : 150;
      context = thread.slice(0, maxLen).replace(/\n/g, ' | ') + (thread.length > maxLen ? '...' : '');
    }
    if (!extractOnly && !proximaEtapa) {
      proximaEtapa = messages.length === 0 ? 'Sem histórico - iniciar conversa' : 'Analisar e definir próxima ação';
    }

    rows.push({ contact: digits, name, context, proximaEtapa, qtdMensagens: messages.length, fullThread: items.length === 1 ? thread : null });
    console.log(messages.length, 'msgs');
    await sleep(80);
  }

  const csvHeaders = 'Contato;Nome;Contexto;Próxima Etapa;Qtd Mensagens';
  const csvRows = rows.map(
    (r) =>
      `${r.contact};${r.name};${escapeCsv(r.context)};${escapeCsv(r.proximaEtapa)};${r.qtdMensagens}`
  );
  const csv = [csvHeaders, ...csvRows].join('\n');

  const mdTable = extractOnly
    ? ''
    : [
        items.length === 1 ? '**As mensagens coletadas estão na seção « Conversa completa » abaixo.**\n' : '',
        '| Contato | Nome | Contexto | Próxima Etapa | Msgs |',
        '|---------|------|----------|---------------|------|',
        ...rows.map((r) => {
          const maxCtx = items.length === 1 ? 500 : 80;
          const maxNext = items.length === 1 ? 200 : 60;
          const ctx = r.context.length > maxCtx ? r.context.slice(0, maxCtx) + '...' : r.context;
          const next = r.proximaEtapa.length > maxNext ? r.proximaEtapa.slice(0, maxNext) + '...' : r.proximaEtapa;
          return `| ${r.contact} | ${r.name} | ${ctx} | ${next} | ${r.qtdMensagens} |`;
        }),
      ].join('\n');

  if (outPath) {
    const abs = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
    fs.writeFileSync(abs, csv, 'utf8');
    const mdPath = abs.replace(/\.csv$/i, '.md');
    let mdContent = mdTable;
    if (items.length === 1) {
      mdContent = buildSingleNumberMdContent({
        mdTable,
        fullThread: rows[0]?.fullThread,
        qtdMensagens: rows[0]?.qtdMensagens ?? 0,
        extractOnly,
      });
    }
    fs.writeFileSync(mdPath, mdContent, 'utf8');
    console.log('\nArquivos gerados:', abs, 'e', mdPath);
  }

  const sendTo = extractOnly ? '' : (process.env.REPORT_SEND_TO || '').trim().replace(/\D/g, '');
  if (sendTo) {
    const destDigits = ensureBrazilian13Digits(sendTo.startsWith('55') ? sendTo : '55' + sendTo);
    const msgToSend = `📋 *Relatório de Análise*\n\n${mdTable}${rows[0]?.fullThread ? `\n\n📩 _Conversa completa:_\n${rows[0].fullThread}` : ''}`;
    try {
      const destId = destDigits + '@c.us';
      const chatId = await resolveChatId(client, destId);
      await client.sendMessage(chatId, msgToSend.slice(0, 4096));
      if (msgToSend.length > 4096) await client.sendMessage(chatId, msgToSend.slice(4096));
      console.log('\n✓ Enviado para', destDigits);
    } catch (err) {
      console.error('\nErro ao enviar:', err.message);
    }
  }

  try {
    await client.destroy();
  } catch (e) {
    if (!String(e?.message || '').includes('Execution context was destroyed')) {
      console.error('Erro ao fechar cliente:', e?.message || e);
    }
  }

  if (!extractOnly) {
    console.log('\n--- Tabela de Análise ---\n');
    console.log(mdTable);
  }
  console.log('\n--- Fim ---');
}

function escapeCsv(val) {
  const s = String(val || '').replace(/"/g, '""');
  return s.includes(';') || s.includes('\n') ? `"${s}"` : s;
}

function buildSingleNumberMdContent({ mdTable, fullThread, qtdMensagens, extractOnly }) {
  const qtd = qtdMensagens ?? 0;
  const header = '## Conversa completa (' + qtd + ' mensagens)\n\n';
  const body = fullThread && String(fullThread).trim()
    ? '```\n' + fullThread + '\n```\n'
    : '```\nNenhuma mensagem coletada. (Abra o chat, clique em "Carregar mensagens mais antigas" e rode de novo.)\n```\n';

  if (extractOnly) return header + body;
  return String(mdTable || '') + '\n\n---\n\n' + header + body;
}

if (require.main === module) {
  main().catch((err) => {
    const msg = err.message || err;
    console.error('Erro:', msg);
    if (String(msg).includes('already running')) {
      console.error('\nDica: Feche todas as janelas do Chrome e rode de novo, ou execute: npm run kill-chrome');
    }
    process.exit(1);
  });
}

module.exports = { buildSingleNumberMdContent };
