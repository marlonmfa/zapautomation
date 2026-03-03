const fs = require('fs');
const path = require('path');
const { getOpenAiApiKey, getFirstContactConfidenceThreshold, getFirstContactReplyDelayRange, getFirstContactRequireHumanForSensitive, getAiKnowledgePdfPath, getAiKnowledgeContextoPath } = require('../config');
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
1) Apresentar o imóvel: se o cliente demonstra interesse ou pergunta sobre o que estamos oferecendo, use o material da apresentação (CONHECIMENTO ADICIONAL) para destacar pontos fortes. Se ainda não sabe o que ele busca, colete: objetivo (morar ou investir), tipo de imóvel, bairro/região, faixa de valor, prazo. Uma pergunta por vez.
2) Quando já tiver uma boa noção do que ele quer, INDUZA a fazer uma simulação de financiamento: explique que com uma simulação ele vê entrada e parcelas. Convide de forma natural.
3) Filtragem (qualificação): colete renda, valor de entrada que tem ou pretende dar, se vai usar FGTS, se tem mais de 3 anos de carteira assinada (CLT). Pergunte uma coisa de cada vez, de forma leve.
4) Só quando tiver TODAS as informações (busca + condições acima), finalize dizendo que vai fazer a simulação e que em breve um corretor entra em contato.

Regras OBRIGATÓRIAS:
- ORDEM DAS PERGUNTAS (sempre nesta sequência, nunca pule nem inverta): 1) objetivo (morar ou investir), 2) tipo de imóvel, 3) bairro ou região, 4) faixa de valor, 5) prazo para compra, 6) renda, 7) valor de entrada, 8) uso de FGTS, 9) carteira assinada (3+ anos). Quando o sistema indicar "Próxima pergunta obrigatória: N/9", sua mensagem DEVE ser APENAS uma pergunta sobre esse item N. Não pergunte sobre outro item antes de receber a resposta do atual.
- NUNCA diga que vai encaminhar, fazer simulação ou que um corretor vai entrar em contato até ter coletado os 9 itens acima, nessa ordem.
- Uma pergunta por vez, tom educado e humano. Português do Brasil, respostas curtas (1–2 frases), sem prefixos.
- Use os dados da apresentação do imóvel (CONHECIMENTO ADICIONAL) para enriquecer as respostas quando o cliente perguntar sobre o empreendimento.

Comunicação natural:
- Evite repetir "Entendi", "Perfeito", "Certo" no início. Varie: vá direto à pergunta, repita em uma palavra o que a pessoa disse, ou um comentário curto e depois a pergunta.
- Fale como no WhatsApp: direto, pode usar "né", "pra", "tá" quando soar natural.

Quebras de gelo (use quando fizer sentido, antes da pergunta obrigatória):
- Comentar algo que a pessoa disse: "Que bom que tá pensando nisso!", "Faz sentido.", "Isso ajuda bastante."
- Transição leve: "Só mais uma coisinha pra te orientar melhor...", "Pra eu já ir encaixando as opções...", "Me conta uma coisa rápida..."
- Reconhecer: "Ótimo, já anotei. Agora...", "Perfeito, com isso já consigo... Então..."
- Não precisa usar em toda mensagem; alterne entre pergunta direta e uma quebra de gelo curta para a conversa não parecer formulário.`;

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

/** Ordem fixa das perguntas. Fallback quando a IA não seguir a ordem. */
const ORDERED_QUESTIONS = [
  { key: 'objetivo', text: 'Você busca o imóvel para morar ou para investir?' },
  { key: 'tipoImovel', text: 'Qual tipo de imóvel te interessa? Apartamento, casa, comercial ou terreno?' },
  { key: 'bairroRegiao', text: 'Tem preferência de bairro ou região aqui em Joinville?' },
  { key: 'faixaValor', text: 'Qual faixa de valor você tem em mente?' },
  { key: 'prazo', text: 'Qual o prazo que você pensa para a compra?' },
  { key: 'renda', text: 'Me conta sua renda mensal? É para eu já encaixar na simulação.' },
  { key: 'valorEntrada', text: 'Quanto você tem ou pretende dar de entrada?' },
  { key: 'usaFGTS', text: 'Você pretende usar o FGTS na entrada ou nas parcelas?' },
  { key: 'carteiraAssinada', text: 'Você tem mais de 3 anos com carteira assinada (CLT)?' },
];

function getQuestionForNextField(fieldKey) {
  const one = ORDERED_QUESTIONS.find((q) => q.key === fieldKey);
  return one ? one.text : '';
}

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

  const nextTopic = missingTopics && missingTopics.length > 0 ? missingTopics[0] : '';
  const totalSteps = 9;
  const nextStepIndex = nextTopic ? totalSteps - missingTopics.length + 1 : 0;
  const topicsHint = nextTopic
    ? `ORDEM FIXA (não pule, não troque). Próxima pergunta obrigatória: ${nextStepIndex}/${totalSteps} — "${nextTopic}". Sua mensagem DEVE ser uma pergunta DIRETA sobre isso (pode começar com uma quebra de gelo curta tipo "Me conta uma coisa..."). NÃO pergunte sobre outros itens da lista agora; só este.`
    : '';

  let knowledgeBlock = '';
  const contextoPath = getAiKnowledgeContextoPath();
  if (contextoPath) {
    const absoluteContexto = path.isAbsolute(contextoPath) ? contextoPath : path.join(process.cwd(), contextoPath);
    if (fs.existsSync(absoluteContexto)) {
      try {
        const contextoText = fs.readFileSync(absoluteContexto, 'utf8');
        const maxContexto = 4000;
        const truncatedContexto = contextoText.length > maxContexto ? contextoText.slice(0, maxContexto) + '...' : contextoText;
        knowledgeBlock += `\n\nCENÁRIO IMOBILIÁRIO E TAXA DE JUROS (use para contextualizar Joinville e impacto dos juros no financiamento):\n${truncatedContexto}\n`;
      } catch (_) {}
    }
  }
  const knowledgePdfPath = getAiKnowledgePdfPath();
  if (knowledgePdfPath) {
    const knowledgeText = await loadKnowledgeFromPdf(knowledgePdfPath);
    if (knowledgeText) {
      const maxChars = 6000;
      const truncated = knowledgeText.length > maxChars ? knowledgeText.slice(0, maxChars) + '...' : knowledgeText;
      knowledgeBlock += `\n\nCONHECIMENTO ADICIONAL - APRESENTAÇÃO DO IMÓVEL (use para responder com base nisso quando relevante):\n${truncated}\n`;
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

  function contactDigits(id) {
    return String(id || '').replace(/@.*$/, '').replace(/\D/g, '');
  }

  async function handleIncomingMessage(client, msg) {
    if (!msg || msg.fromMe) return { action: 'ignore', reason: 'mensagem-do-proprio-agente' };

    const chat = await msg.getChat();
    if (chat.isGroup) return { action: 'ignore', reason: 'grupo-nao-suportado' };

    const messageId = msg.id?._serialized || msg.id?.id || '';
    const contactId = msg.from;
    const memoryKey = contactDigits(contactId) + '@c.us';
    const contact = memory.getContact(memoryKey);
    if (contact.handedOff) {
      return { action: 'ignore', reason: 'ja_encaminhado_ao_corretor' };
    }
    if (messageId && contact.lastIncomingMessageId === messageId) {
      return { action: 'ignore', reason: 'evento-duplicado' };
    }

    const normalized = await normalizeMessage(msg);
    const content = safeContent(normalized);
    memory.appendMessage(memoryKey, { role: 'user', content, messageId });
    memory.updateContact(memoryKey, { lastIncomingMessageId: messageId });

    extractQualificationFromText(content, memory.getContact(memoryKey), memory.updateQualification, memoryKey);
    const contactAfterExtract = memory.getContact(memoryKey);
    if (memory.isQualificationComplete(memoryKey)) {
      const replyText = QUALIFICATION_CLOSING_MESSAGE;
      const delay = randomDelayMs(replyDelay.minMs, replyDelay.maxMs);
      await sleep(delay);
      const sentMsg = await client.sendMessage(contactId, replyText);
      const sentId = sentMsg?.id?._serialized || sentMsg?.id?.id || '';
      memory.appendMessage(memoryKey, { role: 'assistant', content: replyText, messageId: sentId });
      memory.updateContact(memoryKey, {
        state: STATES.ESCALATE_HUMAN,
        lastOutgoingMessageId: sentId,
        handedOff: true,
        lastAction: 'escalate',
      });
      memory.updateSummary(memoryKey);
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
    const qualProgress = memory.getQualificationProgress(memoryKey);

    let action = 'reply';
    let reason = 'auto-reply';
    if (detection.intent === INTENTS.OPT_OUT) {
      action = 'reply';
      memory.updateContact(memoryKey, { doNotContact: true });
      reason = 'opt-out-confirmacao';
    } else if (contact.doNotContact) {
      action = 'ignore';
      reason = 'contato-em-do-not-contact';
    } else if (sensitiveIntent && requireHumanForSensitive && memory.isQualificationComplete(memoryKey)) {
      action = 'escalate';
      reason = 'intent-sensivel';
    } else if (lowConfidence && memory.isQualificationComplete(memoryKey)) {
      action = 'escalate';
      reason = 'baixa-confianca';
    }

    if (action === 'escalate' && !memory.isQualificationComplete(memoryKey)) {
      action = 'reply';
      reason = 'qualificacao-incompleta-nao-escalar';
    }

    let replyText = '';
    if (action === 'reply') {
      const c = memory.getContact(memoryKey);
      const qualProgress = memory.getQualificationProgress(memoryKey);
      const conditionProgress = memory.getConditionProgress(memoryKey);
      const q = c.qualification || {};
      const allCollected = [...qualProgress.collected, ...conditionProgress.collected]
        .map((f) => `${f}=${q[f] || ''}`)
        .join(', ');
      const searchComplete = qualProgress.collected.length >= memory.MIN_QUALIFICATION_FIELDS;
      const missingFields = searchComplete ? conditionProgress.missing : qualProgress.missing;
      const missingTopics = missingFields.map((f) => MISSING_TOPIC_LABELS[f] || f);
      const nextFieldKey = missingFields[0] || '';
      const phaseHint = searchComplete
        ? ' Fase atual: já temos a busca; OBRIGATÓRIO colete as condições para simulação (renda, entrada, FGTS, carteira 3+ anos). Pergunte uma por vez na ordem.'
        : ' Fase atual: colete o que ele busca na ordem: objetivo, tipo, bairro, valor, prazo. Pergunte uma por vez.';
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
      const scriptedQuestion = nextFieldKey ? getQuestionForNextField(nextFieldKey) : '';
      replyText = (aiReply && aiReply.trim()) ? aiReply.trim() : (scriptedQuestion || buildFallbackReply(detection.intent, c));
      const delay = randomDelayMs(replyDelay.minMs, replyDelay.maxMs);
      await sleep(delay);
      const sentMsg = await client.sendMessage(contactId, replyText);
      const sentId = sentMsg?.id?._serialized || sentMsg?.id?.id || '';
      memory.appendMessage(memoryKey, { role: 'assistant', content: replyText, messageId: sentId });
      memory.updateContact(memoryKey, { lastOutgoingMessageId: sentId });
    }

    if (action === 'escalate') {
      replyText = QUALIFICATION_CLOSING_MESSAGE;
      const delay = randomDelayMs(replyDelay.minMs, replyDelay.maxMs);
      await sleep(delay);
      const sentMsg = await client.sendMessage(contactId, replyText);
      const sentId = sentMsg?.id?._serialized || sentMsg?.id?.id || '';
      memory.appendMessage(memoryKey, { role: 'assistant', content: replyText, messageId: sentId });
      memory.updateContact(memoryKey, { lastOutgoingMessageId: sentId, handedOff: true });
    }

    memory.updateContact(memoryKey, {
      state: action === 'escalate' ? STATES.ESCALATE_HUMAN : nextState,
      lastIntent: detection.intent,
      lastConfidence: detection.confidence,
      pendingFields,
      lastAction: action,
    });
    memory.updateSummary(memoryKey);
    memory.persist();

    appendDecision({
      contactId,
      action,
      reason,
      state: memory.getContact(memoryKey).state,
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
      state: memory.getContact(memoryKey).state,
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
