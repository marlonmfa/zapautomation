/**
 * Script de atendimento: sequência de perguntas abertas e de qualificação
 * que o agente (Lucas, Aptom Imóveis) segue para filtrar o lead antes de
 * encaminhar ao corretor humano.
 */

/** Campos de qualificação (ordem usada no script). */
const QUALIFICATION_FIELDS = ['objetivo', 'tipoImovel', 'bairroRegiao', 'faixaValor', 'prazo'];

/**
 * Perguntas abertas (exploratórias) – uma por vez, no início ou entre qualificações.
 * Respostas ajudam a entender dores e contexto; a IA pode extrair dados para qualificação.
 */
const OPEN_QUESTIONS = [
  'O que te fez buscar imóvel agora?',
  'Você já está visitando alguns ou ainda na fase de pesquisa?',
  'O que é mais importante pra você na escolha do imóvel? (localização, valor, tamanho, etc.)',
];

/**
 * Perguntas de qualificação (fechadas/objetivas) – uma por mensagem, na ordem abaixo.
 * Cada uma preenche um campo: objetivo, tipoImovel, bairroRegiao, faixaValor, prazo.
 */
const QUALIFICATION_QUESTIONS = [
  { field: 'objetivo', pergunta: 'É para morar ou para investir (compra para valorização/revenda)?' },
  { field: 'tipoImovel', pergunta: 'Qual tipo de imóvel você busca? (apartamento, casa, sala comercial, terreno)' },
  { field: 'bairroRegiao', pergunta: 'Tem preferência de bairro ou região em Joinville?' },
  { field: 'faixaValor', pergunta: 'Qual faixa de valor ou orçamento máximo você tem em mente?' },
  { field: 'prazo', pergunta: 'Quando você pretende comprar? (ex.: urgente, em alguns meses, ano que vem)' },
];

/**
 * Retorna o próximo passo do script: pergunta aberta ou de qualificação.
 * @param {{ collected: string[], missing: string[] }} qualProgress - resultado de getQualificationProgress(contactId)
 * @param {number} [openIndex=0] - índice da próxima pergunta aberta já feita (guardar no contato se quiser)
 * @returns {{ type: 'open'|'qualification', text: string, field?: string } | null }
 */
function getNextScriptStep(qualProgress, openIndex = 0) {
  const { missing } = qualProgress;

  if (openIndex < OPEN_QUESTIONS.length) {
    return { type: 'open', text: OPEN_QUESTIONS[openIndex] };
  }

  if (missing.length > 0) {
    const nextField = missing[0];
    const step = QUALIFICATION_QUESTIONS.find((q) => q.field === nextField);
    if (step) {
      return { type: 'qualification', text: step.pergunta, field: step.field };
    }
  }

  return null;
}

/**
 * Retorna a próxima pergunta de qualificação (só as 5 objetivas).
 * Compatível com o uso atual do first-contact-agent.
 */
function getNextQualificationQuestion(qualProgress) {
  const step = getNextScriptStep(qualProgress, OPEN_QUESTIONS.length);
  return step && step.type === 'qualification' ? step : null;
}

/**
 * Texto do script para o prompt da IA: instruções e ordem das perguntas.
 */
function getScriptInstructionsForPrompt() {
  const openList = OPEN_QUESTIONS.map((q, i) => `${i + 1}. (aberta) ${q}`).join('\n');
  const qualList = QUALIFICATION_QUESTIONS.map((q, i) => `${i + 1}. ${q.field}: ${q.pergunta}`).join('\n');
  return `
Perguntas abertas (faça no máximo uma por vez, na ordem):
${openList}

Perguntas de qualificação (na ordem, uma por mensagem):
${qualList}

Siga essa ordem: primeiro as abertas (se ainda não fez), depois as de qualificação. Não pule; não repita pergunta já respondida.
`.trim();
}

module.exports = {
  OPEN_QUESTIONS,
  QUALIFICATION_QUESTIONS,
  QUALIFICATION_FIELDS,
  getNextScriptStep,
  getNextQualificationQuestion,
  getScriptInstructionsForPrompt,
};
