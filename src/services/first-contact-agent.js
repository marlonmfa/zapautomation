const { getOpenAiApiKey, getFirstContactConfidenceThreshold, getFirstContactReplyDelayRange, getFirstContactRequireHumanForSensitive } = require('../config');
const { normalizeMessage } = require('./reply-suggestion');
const { createMemoryService } = require('./contact-memory');
const { appendDecision } = require('./decision-logger');
const { detectIntentByRules, getNextState, INTENTS, STATES } = require('./first-contact-policy');

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

function buildFallbackReply(intent, contact) {
  switch (intent) {
    case INTENTS.GREETING:
      return 'Oi! Tudo bem? Sou do time imobiliário em Joinville. Posso te ajudar com preço, localização, disponibilidade, financiamento ou documentação. Sobre o que você quer saber primeiro?';
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

async function generateReplyWithAI({ thread, intent, summary }) {
  const key = (() => {
    try {
      return getOpenAiApiKey();
    } catch {
      return '';
    }
  })();
  if (!key) return '';

  const systemPrompt = `Você é um corretor imobiliário humano de primeiro contato via WhatsApp, especializado em Joinville/SC.
Objetivo: acolher o cliente, entender perfil e estágio da compra e dar os próximos passos com clareza.
Regras:
- português do Brasil, tom educado e direto, sem formalidade excessiva
- no máximo 2 frases curtas por resposta
- faça no máximo 1 pergunta por mensagem
- sempre que possível, confirme: tipo de imóvel (apartamento, casa, sala comercial), faixa de valor aproximada e bairro/região de interesse em Joinville
- para investidores, pergunte sobre objetivo (renda, valorização, curto ou longo prazo)
- não force visita; apenas sugira quando o cliente demonstrar interesse claro
- não prometa condições específicas (taxas, aprovação, descontos) sem ter certeza
- se o cliente sinalizar que quer falar com um humano ou marcar visita, deixe claro que um especialista da imobiliária vai entrar em contato
- intenção detectada: ${intent}
- contexto resumido: ${summary || 'sem resumo prévio'}
Retorne apenas a mensagem final.`;

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
      max_tokens: 120,
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
    if (messageId && contact.lastIncomingMessageId === messageId) {
      return { action: 'ignore', reason: 'evento-duplicado' };
    }

    const normalized = await normalizeMessage(msg);
    const content = safeContent(normalized);
    memory.appendMessage(contactId, { role: 'user', content, messageId });
    memory.updateContact(contactId, { lastIncomingMessageId: messageId });

    const detection = detectIntentByRules(content);
    const nextState = getNextState(contact.state, detection.intent);
    const pendingFields = detectPendingFields(detection.intent, content);
    const sensitiveIntent = detection.intent === INTENTS.COMPLAINT;
    const lowConfidence = detection.confidence < confidenceThreshold;

    let action = 'reply';
    let reason = 'auto-reply';
    if (detection.intent === INTENTS.OPT_OUT) {
      action = 'reply';
      memory.updateContact(contactId, { doNotContact: true });
      reason = 'opt-out-confirmacao';
    } else if (contact.doNotContact) {
      action = 'ignore';
      reason = 'contato-em-do-not-contact';
    } else if (sensitiveIntent && requireHumanForSensitive) {
      action = 'escalate';
      reason = 'intent-sensivel';
    } else if (lowConfidence) {
      action = 'escalate';
      reason = 'baixa-confianca';
    }

    let replyText = '';
    if (action === 'reply') {
      const thread = contact.recentMessages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const aiReply = await generateReplyWithAI({ thread, intent: detection.intent, summary: contact.summary });
      replyText = aiReply || buildFallbackReply(detection.intent, contact);
      const delay = randomDelayMs(replyDelay.minMs, replyDelay.maxMs);
      await sleep(delay);
      const sentMsg = await client.sendMessage(contactId, replyText);
      const sentId = sentMsg?.id?._serialized || sentMsg?.id?.id || '';
      memory.appendMessage(contactId, { role: 'assistant', content: replyText, messageId: sentId });
      memory.updateContact(contactId, { lastOutgoingMessageId: sentId });
    }

    if (action === 'escalate') {
      replyText = 'Entendi seu ponto. Vou encaminhar seu atendimento para um especialista humano continuar com você, tudo bem?';
      const delay = randomDelayMs(replyDelay.minMs, replyDelay.maxMs);
      await sleep(delay);
      const sentMsg = await client.sendMessage(contactId, replyText);
      const sentId = sentMsg?.id?._serialized || sentMsg?.id?.id || '';
      memory.appendMessage(contactId, { role: 'assistant', content: replyText, messageId: sentId });
      memory.updateContact(contactId, { lastOutgoingMessageId: sentId });
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
