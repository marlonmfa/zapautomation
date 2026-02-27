/**
 * Send the batch list using WhatsApp Web via Puppeteer (headless: false).
 * Opens a visible Chrome window, goes to web.whatsapp.com, waits for you to log in
 * (scan QR if needed), then sends each contact's message with random delays.
 *
 * Usage: node src/scripts/send-list-puppeteer.js <path-to-batch.json>
 * Example: node src/scripts/send-list-puppeteer.js batch_lucas/batch-output.json
 *
 * Batch file format: [ { "contact": "5511999999999", "message": "Hello" }, ... ]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { getBatchDelayRange, getPuppeteerExecutablePath, getBatchCooldown, getBatchMaxPerRun } = require('../config');
const { openChatAndSendMessage } = require('../send-via-browser');
const { toBrazilWhatsApp } = require('../batch-lucas-utils');
const { ensureBrazilian13Digits } = require('../batch-sender');
const { generateMessage } = require('../llm-service');

const WHATSAPP_WEB_URL = 'https://web.whatsapp.com';

/** Selectors for WhatsApp Web (may need updates if WhatsApp changes the DOM). */
const SELECTORS = {
  /** QR code container – visible when not logged in */
  qrContainer: 'div[data-ref]',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelayMs(minMs, maxMs) {
  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}

function normalizeContact(contact) {
  const digits = toBrazilWhatsApp(contact);
  if (!digits.length) return '';
  return ensureBrazilian13Digits(digits);
}

module.exports = { normalizeContact, randomDelayMs, sleep };

async function waitForLogin(page, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hasQr = await page.$(SELECTORS.qrContainer).then((e) => !!e);
    if (!hasQr) {
      await sleep(2000);
      const appLoaded = await page.evaluate(() => {
        const app = document.querySelector('#app');
        const hasHeader = app && app.querySelector('header');
        const hasSide = app && (app.querySelector('[data-testid="chat-list"]') || app.querySelector('div[role="textbox"]'));
        return !!(hasHeader || hasSide);
      }).catch(() => false);
      if (appLoaded) return true;
    } else {
      await sleep(1500);
    }
  }
  return false;
}

async function openChatAndSendMessagePuppeteer(browserOrPage, contact, message, options = {}) {
  const phone = normalizeContact(contact);
  if (!phone) throw new Error('Invalid contact: ' + contact);

  const result = await openChatAndSendMessage(browserOrPage, phone, message, {
    timeoutMs: options.timeoutMs || 60000,
  });
  
  if (result.skipped) {
    const err = new Error(result.reason || result.error || 'Skipped');
    err.isSkipped = true;
    throw err;
  }
  
  if (!result.success) {
    throw new Error(result.error || 'Send failed');
  }
  return true;
}

async function main() {
  const batchPath = process.argv[2];
  if (!batchPath) {
    console.error('Usage: node src/scripts/send-list-puppeteer.js <path-to-batch.json>');
    process.exit(1);
  }

  const absolutePath = path.isAbsolute(batchPath) ? batchPath : path.join(process.cwd(), batchPath);
  if (!fs.existsSync(absolutePath)) {
    console.error('File not found:', absolutePath);
    process.exit(1);
  }

  let items;
  try {
    const raw = fs.readFileSync(absolutePath, 'utf8');
    items = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON or read error:', e.message);
    process.exit(1);
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.error('Batch file must be a non-empty array of { contact, message }.');
    process.exit(1);
  }

  const range = getBatchDelayRange();
  const cooldown = getBatchCooldown();
  const maxPerRun = getBatchMaxPerRun();
  const executablePath = getPuppeteerExecutablePath();
  const profileName = process.argv[3] || process.env.PROFILE_NAME || '.puppeteer_wa_web_profile';
  const userDataDir = path.join(process.cwd(), profileName);

  let agentName = "Corretor";
  if (profileName.includes("lucas")) agentName = "Lucas Roberto";
  else if (profileName.includes("thiago")) agentName = "Thiago";
  else if (profileName.includes("bruno")) agentName = "Bruno";

  console.log('--- Envio via WhatsApp Web (Puppeteer, headless: false) ---');
  console.log('Abrindo o navegador. Faça login no WhatsApp Web se ainda não estiver conectado.');
  console.log('');

  const browser = await puppeteer.launch({
    headless: false, // Alterado para false para a janela ser visível novamente
    executablePath: executablePath || undefined,
    userDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  await page.goto(WHATSAPP_WEB_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  const loggedIn = await waitForLogin(page);
  if (!loggedIn) {
    console.error('Timeout: não foi possível detectar login no WhatsApp Web. Escaneie o QR code e tente novamente.');
    await browser.close();
    process.exit(1);
  }

  console.log('Sessão detectada. Iniciando envio da lista.');
  console.log('Total de mensagens:', items.length);
  console.log('Atraso entre envios:', range.minMs / 1000, '-', range.maxMs / 1000, 's');
  console.log('');

  const results = [];
  let sent = 0;
  let failed = 0;
  let totalProcessed = 0;
  const initialLength = items.length;

  while (items.length > 0) {
    if (maxPerRun > 0 && totalProcessed >= maxPerRun) {
      console.log(`\nLimite de envios por rodada atingido (${maxPerRun}). Interrompendo envio.`);
      break;
    }

    const item = items[0];
    const { contact, message, name, context } = item;
    const contactId = normalizeContact(contact);
    
    let messageToPass = message;
    if (name && context) {
      messageToPass = async (chatHistory) => {
        return await generateMessage(agentName, item, chatHistory);
      };
    }

    if (totalProcessed > 0 && cooldown.every > 0 && totalProcessed % cooldown.every === 0) {
      const cooldownMs = randomDelayMs(cooldown.minMs, cooldown.maxMs);
      console.log(`\n[PAUSA LONGA] Descansando por ${(cooldownMs / 60000).toFixed(1)} minutos...\n`);
      await sleep(cooldownMs);
    }

    const delay = randomDelayMs(range.minMs, range.maxMs);
    await sleep(delay);

    console.log(`[${totalProcessed + 1}/${initialLength}] ${contactId} – aguardou ${(delay / 1000).toFixed(1)}s`);

    let erroAconteceu = null;
    let foiPulado = false;
    try {
      await openChatAndSendMessagePuppeteer(browser, contactId, messageToPass);
      results.push({ contact: contactId, success: true });
      sent++;
      console.log(`  → Enviado.`);
      await sleep(1200);
    } catch (err) {
      if (err.isSkipped) {
        foiPulado = true;
        console.log(`  → PULADO: ${err.message}`);
        results.push({ contact: contactId, success: false, skipped: true, error: err.message });
      } else {
        erroAconteceu = err;
        const msg = err && err.message ? err.message : String(err);
        results.push({ contact: contactId, success: false, error: msg });
        failed++;
        console.log(`  → Falha: ${msg}`);
      }
    }
    
    // Remove o item processado e salva a lista restante no arquivo (apenas se for sucesso ou pulado)
    if (results[results.length - 1].success || foiPulado) {
      items.shift();
      fs.writeFileSync(absolutePath, JSON.stringify(items, null, 2));
    } else {
      // Se deu falha, removemos também pra nao travar, mas logamos
      items.shift();
      fs.writeFileSync(absolutePath, JSON.stringify(items, null, 2));
    }

    if (!foiPulado) {
      // Se a falha for rede/desconexão/detatched frame (erro grave no Puppeteer), paramos o script.
      const errMsg = erroAconteceu && erroAconteceu.message ? erroAconteceu.message : '';

      if (errMsg.includes('Detached') || errMsg.includes('ERR_ABORTED') || errMsg.includes('Target closed') || errMsg.includes('Execution context') || errMsg.includes('detached Frame')) {
         console.error('ERRO CRÍTICO NO NAVEGADOR. PARANDO EXECUÇÃO PARA NÃO PULAR CLIENTES...');
         break;
      }
    }
    
    totalProcessed++;
  }

  console.log('');
  console.log('--- Resumo ---');
  console.log('Enviados:', sent, '| Falhas:', failed);
  results.forEach((r) => {
    console.log(r.success ? `  OK ${r.contact}` : `  FALHA ${r.contact}: ${r.error}`);
  });

  await sleep(3000);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.message || err);
    process.exit(1);
  });
}
