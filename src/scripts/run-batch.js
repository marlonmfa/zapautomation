/**
 * Run a batch send: read contacts and messages from a JSON file and send with random delays.
 * All messages are sent from a single browser session (one WhatsApp client); no additional
 * browser instances are created for individual messages.
 * If no session exists, opens a browser with the QR code to sync WhatsApp first, then sends.
 * Usage: node src/scripts/run-batch.js <path-to-batch.json>
 * Batch file format: [ { "contact": "5511999999999", "message": "Hello" }, ... ]
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { createClient } = require('../client');
const { createQRServer } = require('../qr-server');
const { runBatch } = require('../batch-sender');
const { getBatchDelayRange, getBatchSendTimeoutMs, getBatchSkipIfEverSent, getSessionClientId } = require('../config');

/** Fixed port for QR page so the URL is predictable if the browser does not open automatically. */
const QR_SERVER_PORT = 37830;

const args = process.argv.slice(2);
const batchPath = args.find((a) => !a.startsWith('--'));
const forceListOnly = args.includes('--force');
const useApiSend = args.includes('--api');
if (useApiSend) process.env.BATCH_USE_BROWSER_SEND = 'false';
if (!batchPath) {
  console.error('Usage: node src/scripts/run-batch.js <path-to-batch.json> [--force]');
  console.error('  --force  Enviar APENAS para a lista (não pula quem já recebeu; envia para todos no arquivo).');
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

// Single client = single browser session for the entire batch (all messages use this client).
// headless: false so when session is active a browser window with WhatsApp Web is visible to confirm.
const client = createClient({ headless: false });
let qrServer = null;

client.on('auth_failure', (msg) => {
  console.error('Auth failure:', msg);
  if (qrServer) qrServer.close();
  process.exit(1);
});

let batchAborted = false;
let batchAlreadyStarted = false;

client.on('disconnected', (reason) => {
  console.error('Client disconnected:', reason);
  batchAborted = true;
});

client.on('ready', async () => {
  if (batchAlreadyStarted) return;
  batchAlreadyStarted = true;

  if (qrServer) {
    qrServer.setReady();
    setTimeout(() => qrServer.close(), 2000);
  }
  console.log('--- Passo 2: Sessão do WhatsApp ativa ---');
  console.log('Connected to WhatsApp. Sessão confirmada.');
  if (client.pupPage) {
    try {
      await client.pupPage.bringToFront();
    } catch (_) {}
  }
  console.log('Janela do navegador com WhatsApp Web aberta para você confirmar.');
  console.log('');
  console.log('--- Passo 3: Envio em lote ---');
  const range = getBatchDelayRange();
  console.log(`Total de mensagens: ${items.length}`);
  console.log(`Aguarde entre cada envio: ${range.minMs / 1000}-${range.maxMs / 1000}s (verificação + nova tentativa em caso de falha).`);
  console.log('');

  function verboseStep(step) {
    const { type, contactId, attempt, error, reason, lastBodySnippet, nextAttempt } = step;
    const prefix = contactId ? `  ${contactId}` : '  ';
    switch (type) {
      case 'contact_start':
        console.log(`\n  [Contato ${step.current}/${step.total}] ${contactId}`);
        console.log(`${prefix}  Aguardou ${(step.delayMs / 1000).toFixed(1)}s antes do envio.`);
        return;
      case 'already_sent':
        console.log(`${prefix}  → Já enviado (ignorado): ${step.reason}`);
        return;
      case 'attempt_start':
        console.log(`${prefix}  Tentativa ${(attempt || 0) + 1}/${step.maxAttempts}: enviando...`);
        return;
      case 'send_ok':
        console.log(`${prefix}  → Enviado com sucesso.`);
        return;
      case 'send_fail':
        console.log(`${prefix}  → Falha no envio: ${error}`);
        return;
      case 'verify_start':
        console.log(`${prefix}  Verificando última mensagem no chat...`);
        return;
      case 'verify_match':
        console.log(`${prefix}  → Verificado: última mensagem confere. OK.`);
        return;
      case 'verify_fail':
        console.log(`${prefix}  → Verificação falhou: ${reason}`);
        if (lastBodySnippet) console.log(`${prefix}     Trecho da última msg: "${lastBodySnippet}"`);
        return;
      case 'reattempt':
        console.log(`${prefix}  Nova tentativa (tentativa ${nextAttempt})...`);
        return;
      case 'done':
        if (!step.success) console.log(`${prefix}  → Resultado final: FALHOU. ${step.error}`);
        return;
      default:
        break;
    }
  }

  const useBrowserSend = process.env.BATCH_USE_BROWSER_SEND !== 'false';
  const skipIfEverSent = forceListOnly ? false : getBatchSkipIfEverSent();
  const skipIfSentToday = skipIfEverSent;
  if (useBrowserSend) {
    console.log('Modo: envio via navegador (digita a mensagem inteira antes de enviar).');
  }
  if (forceListOnly || !skipIfEverSent) {
    console.log('Modo: enviar apenas para a lista (todos os contatos do arquivo).');
  } else {
    console.log('Regra: envio apenas para quem ainda não recebeu; contatos que já receberam mensagem anteriormente são ignorados.');
  }

  try {
    console.log('Enviando para cada contato (passo a passo abaixo):');
    const result = await runBatch(client, items, {
      sendTimeoutMs: getBatchSendTimeoutMs(),
      useBrowserSend,
      skipIfEverSent,
      skipIfSentToday,
      onProgress: (current, total, contactId) => {
        // Progress is also emitted as contact_start in onStep
      },
      onStep: verboseStep,
    });
    console.log('');
    console.log('--- Passo 4: Resumo ---');
    if (batchAborted) {
      console.error('Envio interrompido (desconexão). Parcial: Enviados:', result.sent, 'Falhas:', result.failed);
    } else {
      console.log('Envio concluído. Enviados:', result.sent, 'Falhas:', result.failed);
    }
    result.results.forEach((r) => {
      let suffix = '';
      if (r.retried > 0) suffix = ` (após ${r.retried} nova(s) tentativa(s))`;
      if (r.alreadySent) suffix = ' (já enviado; ignorado)';
      if (r.skippedSameDay) suffix = ' (já enviado hoje; ignorado)';
      if (r.skippedAlreadyReceived) suffix = ' (já recebeu anteriormente; ignorado)';
      console.log(r.success ? `  OK ${r.contact}${suffix}` : `  FALHA ${r.contact}: ${r.error}`);
    });
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Batch run error:', err.message || err);
    process.exit(1);
  }
});

client.on('qr', async (qr) => {
  if (!qrServer) {
    const qrUrl = `http://127.0.0.1:${QR_SERVER_PORT}`;
    qrServer = await createQRServer({ port: QR_SERVER_PORT, openOnStart: true });
    console.log('');
    console.log('=== SINCRONIZE A SESSÃO (QR CODE) ===');
    console.log('Abra no navegador (a janela pode abrir sozinha):');
    console.log('  ' + qrUrl);
    console.log('Se a janela NÃO abrir, copie e cole o link acima no seu navegador.');
    console.log('');
  }
  const dataUrl = await QRCode.toDataURL(qr, { width: 264, margin: 2 });
  qrServer.setQR(dataUrl);
  const terminalQr = await QRCode.toString(qr, { type: 'terminal' });
  console.log('Escaneie o QR code com o WhatsApp (Dispositivos conectados):\n');
  console.log(terminalQr);
  console.log('\nOu escaneie pela página no navegador. O lote inicia após sincronizar.');
});

client.on('authenticated', () => {
  if (qrServer) qrServer.setAuthenticated();
  console.log('Autenticado. Aguardando sessão ficar pronta...');
});

console.log('--- Passo 1: Conectando ao WhatsApp ---');
console.log('Sessão:', getSessionClientId());
console.log('');

client.initialize().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  console.error('Connection failed:', msg);
  if (msg.includes('Could not find Chrome') || msg.includes('Executable doesn\'t exist')) {
    console.error('\nTip: Set PUPPETEER_EXECUTABLE_PATH in .env to your Chrome path, or run: npm run batch:open');
  }
  if (msg.includes('already running') || msg.includes('Use a different')) {
    console.error('\nTip: Close the WhatsApp Web window opened with "npm run session:open", then run this batch again.');
  }
  if (qrServer) qrServer.close();
  process.exit(1);
});
