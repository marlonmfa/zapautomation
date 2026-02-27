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
const {
  getBatchDelayRange,
  getBatchSendTimeoutMs,
  getBatchSkipIfEverSent,
  getSessionClientId,
  getBatchRequireOptIn,
  getBatchSuppressionFile,
  getBatchMaxPerRun,
  getBatchCooldown,
  getBatchHealthStopRules,
} = require('../config');

/** Fixed port for QR page so the URL is predictable if the browser does not open automatically. */
const QR_SERVER_PORT = 37830;

const args = process.argv.slice(2);
const batchPath = args.find((a) => !a.startsWith('--'));
const forceListOnly = args.includes('--force');
const useApiSend = args.includes('--api');
const pilotMode = args.includes('--pilot');
if (useApiSend) process.env.BATCH_USE_BROWSER_SEND = 'false';
if (!batchPath) {
  console.error('Usage: node src/scripts/run-batch.js <path-to-batch.json> [--force] [--pilot] [--api]');
  console.error('  --force  Enviar APENAS para a lista (não pula quem já recebeu; envia para todos no arquivo).');
  console.error('  --pilot  Limita execução para um lote pequeno e gera relatório de saúde da campanha.');
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

function normalizeContactDigits(contact) {
  return String(contact || '').replace(/@.*$/, '').replace(/\D/g, '');
}

function loadSuppressionSet() {
  const suppressionPath = getBatchSuppressionFile();
  if (!suppressionPath) return new Set();
  const absoluteSuppressionPath = path.isAbsolute(suppressionPath)
    ? suppressionPath
    : path.join(process.cwd(), suppressionPath);
  if (!fs.existsSync(absoluteSuppressionPath)) {
    console.warn(`Aviso: BATCH_SUPPRESSION_FILE não encontrado: ${absoluteSuppressionPath}`);
    return new Set();
  }
  try {
    const raw = fs.readFileSync(absoluteSuppressionPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('Aviso: arquivo de supressão deve ser um array JSON de números/ids.');
      return new Set();
    }
    const set = new Set(parsed.map((v) => normalizeContactDigits(v)).filter(Boolean));
    console.log(`Lista de supressão carregada: ${set.size} contato(s).`);
    return set;
  } catch (err) {
    console.warn(`Aviso: falha ao ler lista de supressão (${err.message}).`);
    return new Set();
  }
}

function writeCampaignReport(report) {
  try {
    const reportDir = path.join(process.cwd(), 'reports');
    fs.mkdirSync(reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `batch-health-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return reportPath;
  } catch (err) {
    console.warn(`Aviso: não foi possível salvar relatório: ${err.message}`);
    return '';
  }
}

const suppressionSet = loadSuppressionSet();
items = items.map((item) => {
  const digits = normalizeContactDigits(item && item.contact);
  return {
    ...item,
    suppressed: digits ? suppressionSet.has(digits) : false,
  };
});

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
  const requireOptIn = getBatchRequireOptIn();
  const maxPerRun = Math.max(0, getBatchMaxPerRun());
  const cooldown = getBatchCooldown();
  const stopRules = getBatchHealthStopRules();
  const pilotCap = 50;
  const runLimit = pilotMode ? (maxPerRun > 0 ? Math.min(maxPerRun, pilotCap) : pilotCap) : maxPerRun;
  if (useBrowserSend) {
    console.log('Modo: envio via navegador (digita a mensagem inteira antes de enviar).');
  }
  if (forceListOnly || !skipIfEverSent) {
    console.log('Modo: enviar apenas para a lista (todos os contatos do arquivo).');
  } else {
    console.log('Regra: envio apenas para quem ainda não recebeu; contatos que já receberam mensagem anteriormente são ignorados.');
  }
  if (requireOptIn) {
    console.log('Regra de compliance: somente contatos com opt-in explícito serão enviados.');
  }
  if (pilotMode) {
    console.log(`Modo piloto ativo: execução limitada a ${runLimit} contato(s) processados.`);
  }
  if (runLimit > 0 && !pilotMode) {
    console.log(`Limite por execução ativo: até ${runLimit} contato(s) processados.`);
  }
  if (cooldown.every > 0) {
    console.log(`Cooldown ativo: pausa aleatória de ${(cooldown.minMs / 1000).toFixed(0)}-${(cooldown.maxMs / 1000).toFixed(0)}s a cada ${cooldown.every} contatos processados.`);
  }
  if (stopRules.failRate > 0 && stopRules.minAttempts > 0) {
    console.log(`Stop automático por falha: ${(stopRules.failRate * 100).toFixed(1)}% após ${stopRules.minAttempts} tentativas.`);
  }
  if (stopRules.blockLikeCount > 0) {
    console.log(`Stop automático por erros críticos: ${stopRules.blockLikeCount} erro(s) com padrão de bloqueio.`);
  }

  try {
    console.log('Enviando para cada contato (passo a passo abaixo):');
    const result = await runBatch(client, items, {
      sendTimeoutMs: getBatchSendTimeoutMs(),
      useBrowserSend,
      skipIfEverSent,
      skipIfSentToday,
      requireOptIn,
      maxPerRun: runLimit,
      cooldownEvery: cooldown.every,
      cooldownMinMs: cooldown.minMs,
      cooldownMaxMs: cooldown.maxMs,
      stopFailRate: stopRules.failRate,
      stopMinAttempts: stopRules.minAttempts,
      stopBlockLikeCount: stopRules.blockLikeCount,
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
    if (result.stoppedEarly) {
      console.warn('Envio pausado automaticamente:', result.stopReason || 'guardrail acionado.');
    }
    result.results.forEach((r) => {
      let suffix = '';
      if (r.retried > 0) suffix = ` (após ${r.retried} nova(s) tentativa(s))`;
      if (r.alreadySent) suffix = ' (já enviado; ignorado)';
      if (r.skippedSameDay) suffix = ' (já enviado hoje; ignorado)';
      if (r.skippedAlreadyReceived) suffix = ' (já recebeu anteriormente; ignorado)';
      if (r.skippedOptOut) suffix = ' (opt-out; ignorado)';
      if (r.skippedMissingConsent) suffix = ' (sem opt-in; ignorado)';
      if (r.skippedSuppressionList) suffix = ' (lista de supressão; ignorado)';
      console.log(r.success ? `  OK ${r.contact}${suffix}` : `  FALHA ${r.contact}: ${r.error}`);
    });
    const attempts = result.metrics?.attempts || 0;
    const failRate = attempts > 0 ? ((result.metrics.failRate || 0) * 100).toFixed(2) : '0.00';
    console.log('');
    console.log('--- Saúde da campanha ---');
    console.log(`Tentativas: ${attempts}`);
    console.log(`Taxa de falha: ${failRate}%`);
    console.log(`Erros com padrão de bloqueio: ${result.metrics?.blockLikeErrors || 0}`);
    if (result.metrics?.skipped) {
      const sk = result.metrics.skipped;
      console.log(`Ignorados -> opt-out: ${sk.optOut}, sem opt-in: ${sk.missingConsent}, supressão: ${sk.suppressionList}, já receberam: ${sk.alreadyReceived}, hoje: ${sk.sentToday}`);
    }
    const report = {
      generatedAt: new Date().toISOString(),
      batchPath: absolutePath,
      options: {
        pilotMode,
        useBrowserSend,
        skipIfEverSent,
        skipIfSentToday,
        requireOptIn,
        runLimit,
        cooldown,
        stopRules,
      },
      result,
      recommendation: (() => {
        const isHealthy = (result.metrics?.failRate || 0) <= 0.1 && (result.metrics?.blockLikeErrors || 0) === 0;
        if (!isHealthy) {
          return {
            healthy: false,
            action: 'Do not scale volume. Review list quality, message copy, and cadence before next run.',
          };
        }
        const currentBase = runLimit > 0 ? runLimit : items.length;
        return {
          healthy: true,
          action: 'Scale carefully in the next run.',
          suggestedNextMaxPerRun: Math.max(1, Math.floor(currentBase * 1.25)),
        };
      })(),
    };
    const reportPath = writeCampaignReport(report);
    if (reportPath) console.log(`Relatório salvo em: ${reportPath}`);
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
