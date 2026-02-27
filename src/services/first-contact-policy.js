const STATES = {
  NEW_CONTACT: 'novo_contato',
  COLLECTING_DATA: 'coletando_dados',
  TECHNICAL_QUESTION: 'duvida_tecnica',
  ESCALATE_HUMAN: 'encaminhar_humano',
  CLOSED: 'encerrado',
};

const INTENTS = {
  PRICE: 'preco',
  LOCATION: 'localizacao',
  AVAILABILITY: 'disponibilidade',
  FINANCING: 'financiamento',
  DOCUMENTATION: 'documentacao',
  SCHEDULE: 'agendamento',
  GREETING: 'saudacao',
  OPT_OUT: 'opt_out',
  COMPLAINT: 'reclamacao',
  UNKNOWN: 'desconhecido',
};

const ESCALATION_KEYWORDS = [
  'procon',
  'processo',
  'advogado',
  'justica',
  'reclamacao',
  'denuncia',
  'golpe',
  'fraude',
];

const OPT_OUT_KEYWORDS = [
  'parar',
  'cancelar',
  'nao quero',
  'não quero',
  'remover',
  'sair',
  'stop',
];

const INTENT_RULES = [
  { intent: INTENTS.PRICE, keywords: ['preco', 'preço', 'valor', 'custa', 'entrada', 'parcela'], confidence: 0.84 },
  { intent: INTENTS.LOCATION, keywords: ['bairro', 'regiao', 'região', 'localizacao', 'localização', 'endereco', 'endereço'], confidence: 0.84 },
  { intent: INTENTS.AVAILABILITY, keywords: ['tem unidade', 'disponivel', 'disponível', 'ainda tem', 'estoque'], confidence: 0.8 },
  { intent: INTENTS.FINANCING, keywords: ['financiamento', 'financiar', 'fgts', 'credito', 'crédito', 'simulacao', 'simulação'], confidence: 0.86 },
  { intent: INTENTS.DOCUMENTATION, keywords: ['documento', 'documentacao', 'documentação', 'rg', 'cpf', 'comprovante'], confidence: 0.82 },
  { intent: INTENTS.SCHEDULE, keywords: ['visita', 'agendar', 'marcar', 'horario', 'horário'], confidence: 0.85 },
  { intent: INTENTS.GREETING, keywords: ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite'], confidence: 0.65 },
];

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function containsAny(text, keywords) {
  const t = normalizeText(text);
  return keywords.some((k) => t.includes(normalizeText(k)));
}

function detectIntentByRules(text) {
  if (!text || !String(text).trim()) {
    return { intent: INTENTS.UNKNOWN, confidence: 0.3, reason: 'mensagem-vazia' };
  }
  if (containsAny(text, OPT_OUT_KEYWORDS)) {
    return { intent: INTENTS.OPT_OUT, confidence: 0.98, reason: 'keyword-opt-out' };
  }
  if (containsAny(text, ESCALATION_KEYWORDS)) {
    return { intent: INTENTS.COMPLAINT, confidence: 0.92, reason: 'keyword-escalacao' };
  }
  for (const rule of INTENT_RULES) {
    if (containsAny(text, rule.keywords)) {
      return { intent: rule.intent, confidence: rule.confidence, reason: 'rule-match' };
    }
  }
  return { intent: INTENTS.UNKNOWN, confidence: 0.45, reason: 'sem-regra' };
}

function getNextState(currentState, intent) {
  if (intent === INTENTS.OPT_OUT) return STATES.CLOSED;
  if (intent === INTENTS.COMPLAINT) return STATES.ESCALATE_HUMAN;
  if ([INTENTS.FINANCING, INTENTS.PRICE, INTENTS.LOCATION, INTENTS.AVAILABILITY, INTENTS.DOCUMENTATION].includes(intent)) {
    return STATES.COLLECTING_DATA;
  }
  if (intent === INTENTS.SCHEDULE) return STATES.TECHNICAL_QUESTION;
  if (currentState && currentState !== STATES.NEW_CONTACT) return currentState;
  return STATES.NEW_CONTACT;
}

module.exports = {
  STATES,
  INTENTS,
  ESCALATION_KEYWORDS,
  OPT_OUT_KEYWORDS,
  detectIntentByRules,
  getNextState,
};
