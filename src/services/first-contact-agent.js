const { getOpenAiApiKey, getFirstContactConfidenceThreshold, getFirstContactReplyDelayRange, getFirstContactRequireHumanForSensitive, getAiKnowledgePdfPath } = require('../config');
const { normalizeMessage } = require('./reply-suggestion');
const { createMemoryService } = require('./contact-memory');
const { appendDecision } = require('./decision-logger');
const { detectIntentByRules, getNextState, INTENTS, STATES } = require('./first-contact-policy');
const { loadKnowledgeFromPdf } = require('./knowledge-from-pdf');

/** Mensagem ao encerrar após qualificação + condições (vai fazer simulação). */
const QUALIFICATION_CLOSING_MESSAGE = 'Vou fazer a simulação com os dados que você passou. Em breve um corretor da Aptom Imóveis entra em contato com o resultado (entrada e parcelas).';

/** Mensagem de apresentação já enviada pelo batch (disparo). */
const PRESENTATION_ALREADY_SENT = 'Oi, tudo bem? Aqui é o Lucas, da Aptom Imóveis. Vi seu interesse no apartamento da Rua Gastronômica, no centro de Joinville, e queria te ajudar com mais informações.';

/** Persona: atendente que apresenta o imóvel (BlitzHaus) e depois faz filtragem para simulação. */
const ATTENDANT_PERSONA = `Você é o Lucas, atendente da Aptom Imóveis em Joinville, Santa Catarina.
CONTEXTO: Atuamos apenas com VENDA de imóveis (compra e venda). Não temos locação; se perguntarem por aluguel, diga educadamente que trabalhamos só com compra e venda em Joinville/SC.

Quando houver CONHECIMENTO ADICIONAL (apresentação do imóvel) no prompt, use-o para falar do empreendimento: localização, diferenciais, plantas, valor, entrega etc. Apresente o apartamento/empreendimento de forma atrativa e curta, em 1–2 frases quando fizer sentido.

Fluxo do atendimento (siga nesta ordem, de forma natural):
1) Apresentar o imóvel: se o cliente demonstra interesse ou pergunta sobre o que estamos oferecendo, use o material da apresentação (CONHECIMENTO ADICIONAL) para destacar pontos fortes. Se ainda não sabe o que ele busca, entenda: para morar ou investir, tipo de imóvel, bairro/região, faixa de valor, prazo. Uma pergunta ou comentário por vez.
2) Quando já tiver uma boa noção do que ele quer, INDUZA a fazer uma simulação de financiamento: explique que com uma simulação ele vê entrada e parcelas. Convide de forma natural.
3) Filtragem (qualificação): renda, valor de entrada que tem ou pretende dar, se vai usar FGTS, se tem mais de 3 anos de carteira assinada (CLT). Pergunte uma coisa de cada vez, de forma leve.
4) Quando tiver as informações de busca e as condições (renda, entrada, FGTS, carteira), finalize dizendo que vai fazer a simulação e que em breve um corretor entra em contato. Não diga que vai encaminhar antes de ter essas informações.

Regras:
- NUNCA diga que vai encaminhar para um corretor ou humano até o sistema avisar que a qualificação está completa (busca + condições).
- Uma pergunta ou comentário por vez, tom educado e humano. Português do Brasil, respostas curtas (1–2 frases), sem prefixos.
- Use os dados da apresentação do imóvel (CONHECIMENTO ADICIONAL) para enriquecer as respostas quando o cliente perguntar sobre o empreendimento.

Comunicação natural:
- Evite repetir "Entendi", "Perfeito", "Certo" no início. Varie: vá direto à pergunta, repita em uma palavra o que a pessoa disse, ou um comentário curto e depois a pergunta.
- Fale como no WhatsApp: direto, pode usar "né", "pra", "tá" quando soar natural.`;

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs(minMs, maxMs) {
  if (minMs >= maxMs) return minMs;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function safeContent(msg) {
  return (msg && typeof msg.content === 'string' ? msg.content : '').trim();
}

function detectPendingFields(intent, text) {
  const t = String(text || '').toLowerCase();
  const fields = [];
  if (intent === INTENTS.PRICE && !t.includes('entrada') && !t.includes('faixa')) fields.push('faixa_preco');
  if (intent === INTENTS.LOCATION && !t.includes('bairro')) fields.push('bairro_preferido');
  if (intent === INTENTS.SCHEDULE && !t.includes('hor')) fields.push('horario_preferido');
  return fields;
}

/**
 * Extrai dados de qualificação da última mensagem do cliente e preenche o que faltar no contato.
 * @param {string} text - conteúdo da mensagem
 * @param {object} contact - contato com contact.qualification
 * @param {function} updateQualification - (contactId, field, value) => void
 * @param {string} contactId
 */
function extractQualificationFromText(text, contact, updateQualification, contactId) {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = contact.qualification || {};

  if (!q.objetivo && /(morar|residir|proprio|1o imovel|primeiro imovel|pra mim)/.test(t)) {
    updateQualification(contactId, 'objetivo', 'morar');
  }
  if (!q.objetivo && /(investir|renda|aluguel|valoriz|revender)/.test(t)) {
    updateQualification(contactId, 'objetivo', 'investir');
  }

  if (!q.tipoImovel && /(apartamento|apto|ap\s|ap,)/.test(t)) {
    updateQualification(contactId, 'tipoImovel', 'apartamento');
  }
  if (!q.tipoImovel && /(casa|sobrado)/.test(t)) {
    updateQualification(contactId, 'tipoImovel', 'casa');
  }
  if (!q.tipoImovel && /(sala|comercial|galpao|galpão)/.test(t)) {
    updateQualification(contactId, 'tipoImovel', 'comercial');
  }
  if (!q.tipoImovel && /terreno/.test(t)) {
    updateQualification(contactId, 'tipoImovel', 'terreno');
  }

  if (!q.bairroRegiao && /(bairro|região|regiao|centro|america|anita|zona norte|sul|bom retiro|gloria|atirradouro|iririú|iririu|costa e silva|jardim sofia)/.test(t)) {
    const slice = String(text || '').trim().slice(0, 150);
    updateQualification(contactId, 'bairroRegiao', slice || 'região informada');
  }

  if (!q.faixaValor && (/\d{2,3}\s*k|\d+\.?\d*\s*mil|\d{1,3}(\.\d{3})*\s*reais|até\s*\d|ate\s*\d|orcamento|orçamento|entrada|faixa/.test(t) || /\d{5,}/.test(t))) {
    const slice = String(text || '').trim().slice(0, 80);
    updateQualification(contactId, 'faixaValor', slice || 'faixa informada');
  }

  if (!q.prazo && /(urgente|logo|agora|alguns meses|3\s*meses|6\s*meses|ano que vem|1\s*ano|longo prazo|curto prazo)/.test(t)) {
    const slice = String(text || '').trim().slice(0, 80);
    updateQualification(contactId, 'prazo', slice || 'prazo informado');
  }

  if (!q.renda && (/\d{2,3}\s*k|\d+\.?\d*\s*mil|\d{1,3}(\.\d{3})*\s*reais|ganho|recebo|salario|salário|renda|bruto|líquido/.test(t) || /\d{4,}/.test(t))) {
    const slice = String(text || '').trim().slice(0, 80);
    updateQualification(contactId, 'renda', slice || 'renda informada');
  }
  if (!q.valorEntrada && /(entrada|dar\s*de\s*entrada|tenho\s*\d|junto\s*\d|reserva|economia)/.test(t)) {
    const slice = String(text || '').trim().slice(0, 80);
    updateQualification(contactId, 'valorEntrada', slice || 'entrada informada');
  }
  if (!q.usaFGTS && /(fgts|f\.g\.t\.s|fundos\s*de\s*garantia)/.test(t)) {
    if (/(não|nao|sem\s*fgts|não\s*tenho)/.test(t)) updateQualification(contactId, 'usaFGTS', 'não');
    else updateQualification(contactId, 'usaFGTS', 'sim');
  }
  if (!q.carteiraAssinada && /(carteira|clt|emprego|empregado|assinada|3\s*anos|mais\s*de\s*3)/.test(t)) {
    if (/(não|nao|autônomo|autonomo|pj)/.test(t)) updateQualification(contactId, 'carteiraAssinada', 'não ou menos de 3 anos');
    else updateQualification(contactId, 'carteiraAssinada', 'sim, 3+ anos');
  }
}

const MISSING_TOPIC_LABELS = {
  objetivo: 'objetivo (morar ou investir)',
  tipoImovel: 'tipo de imóvel',
  bairroRegiao: 'bairro ou região',
  faixaValor: 'faixa de valor',
  prazo: 'prazo para compra',
  renda: 'renda (para simulação de financiamento)',
  valorEntrada: 'valor de entrada que tem ou pretende dar',
  usaFGTS: 'se pretende usar FGTS',
  carteiraAssinada: 'se tem mais de 3 anos com carteira assinada (CLT)',
};

function buildFallbackReply(intent, contact) {
  switch (intent) {
    case INTENTS.GREETING:
      return 'Que bom falar com você! O que te fez buscar imóvel agora?';
    case INTENTS.PRICE:
      return 'Claro! Posso te ajudar com valores. Você já tem uma faixa de preço em mente para eu te orientar melhor?';
    case INTENTS.LOCATION:
      return 'Perfeito. Você tem preferência de bairro ou região aqui em Joinville para eu te indicar as melhores opções?';
    case INTENTS.AVAILABILITY:
      return 'Temos opções disponíveis sim. Você busca quantos quartos e para qual prazo de mudança?';
    case INTENTS.FINANCING:
      return 'Consigo te orientar no financiamento. Você pretende usar FGTS ou já tem uma entrada definida?';
    case INTENTS.DOCUMENTATION:
      return 'Posso te passar os documentos principais. Você quer a lista para financiamento ou para compra à vista?';
    case INTENTS.SCHEDULE:
      return 'Perfeito, consigo te ajudar com agendamento. Qual melhor dia e horário para você?';
    case INTENTS.OPT_OUT:
      return 'Tudo certo, vou respeitar seu pedido e não enviaremos novas mensagens por aqui.';
    default:
      if (contact && contact.summary) {
        return 'Entendi. Para te responder com precisão, você pode me dizer um pouco mais do que precisa agora?';
      }
      return 'Entendi. Posso te ajudar com dúvidas iniciais. Você quer saber sobre preço, localização, disponibilidade, financiamento ou documentação?';
  }
}

async function generateReplyWithAI({ thread, intent, summary, qualificationCollected, missingTopics, phaseHint = '' }) {
  const key = (() => {
    try {
      return getOpenAiApiKey();
    } catch {
      return '';
    }
  })();
  if (!key) return '';

  const topicsHint = missingTopics && missingTopics.length > 0
    ? `Ainda pode ser útil entender: ${missingTopics.join(', ')}. Traga na conversa quando fizer sentido.`
    : '';

  let knowledgeBlock = '';
  const knowledgePdfPath = getAiKnowledgePdfPath();
  if (knowledgePdfPath) {
    const knowledgeText = await loadKnowledgeFromPdf(knowledgePdfPath);
    if (knowledgeText) {
      const maxChars = 6000;
      const truncated = knowledgeText.length > maxChars ? knowledgeText.slice(0, maxChars) + '...' : knowledgeText;
      knowledgeBlock = `\n\nCONHECIMENTO ADICIONAL (use para responder com base nisso quando relevante):\n${truncated}\n`;
    }
  }

  const systemPrompt = `${ATTENDANT_PERSONA}${knowledgeBlock}

Este contato já recebeu a mensagem de apresentação. Não se apresente de novo; continue a conversa de forma natural.

O que já sabemos sobre o cliente: ${qualificationCollected || 'nada ainda'}.${phaseHint || ''}
${topicsHint ? topicsHint + '\n' : ''}
Intenção da última mensagem: ${intent}. Contexto geral: ${summary || 'sem resumo prévio'}.

Responda em uma ou duas frases curtas. Varie o começo da frase (evite repetir "Entendi", "Perfeito", "Certo"); seja natural como no WhatsApp. Retorne apenas a mensagem final, sem prefixos.`;

  const userContent = thread.map((m) => `${m.role === 'assistant' ? 'Atendente' : 'Cliente'}: ${m.content}`).join('\n');
  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: 150,
      temperature: 0.7,
    }),
  });
  if (!response.ok) return '';
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text.trim() : '';
}

function createFirstContactAgent(options = {}) {
  const memory = createMemoryService(options.memoryPath);
  const confidenceThreshold = options.confidenceThreshold ?? getFirstContactConfidenceThreshold();
  const replyDelay = options.replyDelay || getFirstContactReplyDelayRange();
  const requireHumanForSensitive = options.requireHumanForSensitive ?? getFirstContactRequireHumanForSensitive();

  async function handleIncomingMessage(client, msg) {
    if (!msg || msg.fromMe) return { action: 'ignore', reason: 'mensagem-do-proprio-agente' };

    const chat = await msg.getChat();
    if (chat.isGroup) return { action: 'ignore', reason: 'grupo-nao-suportado' };

    const messageId = msg.id?._serialized || msg.id?.id || '';
    const contactId = msg.from;
    const contact = memory.getContact(contactId);
    if (contact.handedOff) {
      return { action: 'ignore', reason: 'ja_encaminhado_ao_corretor' };
    }
    if (messageId && contact.lastIncomingMessageId === messageId) {
      return { action: 'ignore', reason: 'evento-duplicado' };
    }

    const normalized = await normalizeMessage(msg);
    const content = safeContent(normalized);
    memory.appendMessage(contactId, { role: 'user', content, messageId });
    memory.updateContact(contactId, { lastIncomingMessageId: messageId });

    extractQualificationFromText(content, memory.getContact(contactId), memory.updateQualification, contactId);
    const contactAfterExtract = memory.getContact(contactId);
    if (memory.isQualificationComplete(contactId)) {
      const replyText = QUALIFICATION_CLOSING_MESSAGE;
      const delay = randomDelayMs(replyDelay.minMs, replyDelay.maxMs);
      await sleep(delay);
      const sentMsg = await client.sendMessage(contactId, replyText);
      const sentId = sentMsg?.id?._serialized || sentMsg?.id?.id || '';
      memory.appendMessage(contactId, { role: 'assistant', content: replyText, messageId: sentId });
      memory.updateContact(contactId, {
        state: STATES.ESCALATE_HUMAN,
        lastOutgoingMessageId: sentId,
        handedOff: true,
        lastAction: 'escalate',
      });
      memory.updateSummary(contactId);
      memory.persist();
      appendDecision({
        contactId,
        action: 'escalate',
        reason: 'qualificacao_completa',
        state: STATES.ESCALATE_HUMAN,
        intent: 'qualificacao',
        confidence: 1,
        pendingFields: [],
        replyText,
        messageId,
        qualification: contactAfterExtract.qualification,
      }, options.decisionsLogPath);
      return {
        action: 'escalate',
        reason: 'qualificacao_completa',
        contactId,
        intent: 'qualificacao',
        confidence: 1,
        state: STATES.ESCALATE_HUMAN,
        replyText,
      };
    }

    const detection = detectIntentByRules(content);
    const nextState = getNextState(contact.state, detection.intent);
    const pendingFields = detectPendingFields(detection.intent, content);
    const sensitiveIntent = detection.intent === INTENTS.COMPLAINT;
    const lowConfidence = detection.confidence < confidenceThreshold;
    const qualProgress = memory.getQualificationProgress(contactId);

    let action = 'reply';
    let reason = 'auto-reply';
    if (detection.intent === INTENTS.OPT_OUT) {
      action = 'reply';
      memory.updateContact(contactId, { doNotContact: true });
      reason = 'opt-out-confirmacao';
    } else if (contact.doNotContact) {
      action = 'ignore';
      reason = 'contato-em-do-not-contact';
    } else if (sensitiveIntent && requireHumanForSensitive && memory.isQualificationComplete(contactId)) {
      action = 'escalate';
      reason = 'intent-sensivel';
    } else if (lowConfidence && memory.isQualificationComplete(contactId)) {
      action = 'escalate';
      reason = 'baixa-confianca';
    }

    if (action === 'escalate' && !memory.isQualificationComplete(contactId)) {
      action = 'reply';
      reason = 'qualificacao-incompleta-nao-escalar';
    }

    let replyText = '';
    if (action === 'reply') {
      const c = memory.getContact(contactId);
      const qualProgress = memory.getQualificationProgress(contactId);
      const conditionProgress = memory.getConditionProgress(contactId);
      const q = c.qualification || {};
      const allCollected = [...qualProgress.collected, ...conditionProgress.collected]
        .map((f) => `${f}=${q[f] || ''}`)
        .join(', ');
      const searchComplete = qualProgress.collected.length >= memory.MIN_QUALIFICATION_FIELDS;
      const missingTopics = searchComplete
        ? conditionProgress.missing.map((f) => MISSING_TOPIC_LABELS[f] || f)
        : qualProgress.missing.map((f) => MISSING_TOPIC_LABELS[f] || f);
      const phaseHint = searchComplete
        ? ' Fase atual: já sabemos o que ele busca; induza a simulação e colete condições (renda, entrada, FGTS, carteira 3+ anos).'
        : '';
      let thread = c.recentMessages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const hasAssistantInThread = thread.some((m) => m.role === 'assistant');
      if (!hasAssistantInThread) {
        thread = [{ role: 'assistant', content: PRESENTATION_ALREADY_SENT }, ...thread];
      }
      const aiReply = await generateReplyWithAI({
        thread,
        intent: detection.intent,
        summary: c.summary,
        qualificationCollected: allCollected || 'nada ainda',
        missingTopics,
        phaseHint,
      });
      replyText = aiReply || buildFallbackReply(detection.intent, c);
      const delay = randomDelayMs(replyDelay.minMs, replyDelay.maxMs);
      await sleep(delay);
      const sentMsg = await client.sendMessage(contactId, replyText);
      const sentId = sentMsg?.id?._serialized || sentMsg?.id?.id || '';
      memory.appendMessage(contactId, { role: 'assistant', content: replyText, messageId: sentId });
      memory.updateContact(contactId, { lastOutgoingMessageId: sentId });
    }

    if (action === 'escalate') {
      replyText = QUALIFICATION_CLOSING_MESSAGE;
      const delay = randomDelayMs(replyDelay.minMs, replyDelay.maxMs);
      await sleep(delay);
      const sentMsg = await client.sendMessage(contactId, replyText);
      const sentId = sentMsg?.id?._serialized || sentMsg?.id?.id || '';
      memory.appendMessage(contactId, { role: 'assistant', content: replyText, messageId: sentId });
      memory.updateContact(contactId, { lastOutgoingMessageId: sentId, handedOff: true });
    }

    memory.updateContact(contactId, {
      state: action === 'escalate' ? STATES.ESCALATE_HUMAN : nextState,
      lastIntent: detection.intent,
      lastConfidence: detection.confidence,
      pendingFields,
      lastAction: action,
    });
    memory.updateSummary(contactId);
    memory.persist();

    appendDecision({
      contactId,
      action,
      reason,
      state: memory.getContact(contactId).state,
      intent: detection.intent,
      confidence: detection.confidence,
      pendingFields,
      replyText,
      messageId,
    }, options.decisionsLogPath);

    return {
      action,
      reason,
      contactId,
      intent: detection.intent,
      confidence: detection.confidence,
      state: memory.getContact(contactId).state,
      replyText,
    };
  }

  return {
    handleIncomingMessage,
    memory,
  };
}

module.exports = {
  createFirstContactAgent,
};
