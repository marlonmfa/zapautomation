/**
 * Serviço de Roteiro Baseado em Regras (On-the-fly) sem IA externa.
 * Analisa as strings do chat e determina a próxima ação.
 */

// Spintax básico para não mandar a exata mesma mensagem
function getRandomOption(options) {
  return options[Math.floor(Math.random() * options.length)];
}

function parseWhatsAppDate(dateStr) {
  // Datas no WhatsApp podem ser: "10:45", "Ontem", "Quarta-feira", "25/02/2026"
  // Esta função tenta estimar se a data é recente (hoje/ontem/dia da semana) ou antiga (data completa)
  if (!dateStr) return 'old';
  
  const lowerDate = dateStr.toLowerCase();
  
  // Se for só horário (ex: 10:45), é hoje.
  if (/^\d{2}:\d{2}$/.test(lowerDate)) return 'recent';
  if (lowerDate.includes('ontem')) return 'recent';
  
  // Dias da semana costumam ser de menos de 7 dias atrás
  const days = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  for (let d of days) {
    if (lowerDate.includes(d)) return 'recent';
  }
  
  // Se tem barra (ex: 15/02/2026), vamos olhar o mês/ano, mas no geral consideramos "old" se chegou nesse formato
  return 'old';
}

function analyzeHistory(chatHistory) {
  let isRecent = false;
  let mentionsCompetitor = false;

  // Palavras-chave negativas
  const negativeKeywords = ['já comprei', 'ja comprei', 'outro corretor', 'desisti', 'não tenho interesse', 'nao quero mais', 'fechei negócio', 'concorrente'];

  for (let msg of chatHistory) {
    // msg vem no formato: "[10:45] Cliente: Olá" ou "[15/02/2026] Corretor: Tudo bem?"
    const match = msg.match(/^\[(.*?)\] (Corretor|Cliente): (.*)$/i);
    if (match) {
      const dateStr = match[1];
      const text = match[3].toLowerCase();

      // Checa idade da mensagem
      if (parseWhatsAppDate(dateStr) === 'recent') {
        isRecent = true;
      }

      // Checa palavras-chave (somente na fala do cliente)
      if (match[2].toLowerCase() === 'cliente') {
        for (let kw of negativeKeywords) {
          if (text.includes(kw)) {
            mentionsCompetitor = true;
            break;
          }
        }
      }
    }
  }

  return { isRecent, mentionsCompetitor };
}

/**
 * @param {string} agentName - O nome do corretor (Lucas Roberto, Thiago, Bruno)
 * @param {object} clientData - { name: 'João', context: 'SANTIS 04.12' }
 * @param {Array<string>} chatHistory - Array com as últimas mensagens do chat
 * @returns {Promise<{action: string, reason: string, message: string}>}
 */
async function generateMessage(agentName, clientData, chatHistory) {
  const { name, context } = clientData;
  const hasHistory = chatHistory && chatHistory.length > 0;

  // 1. Regra: Sem histórico
  if (!hasHistory) {
    const greetings = ['Olá', 'Oi', 'Opa'];
    const greetings2 = ['tudo bem?', 'como vai?', 'tudo certo?'];
    
    let msg = `${getRandomOption(greetings)} ${name}, ${getRandomOption(greetings2)} `;
    msg += `Aqui é o ${agentName} da Aptom Imóveis. `;
    msg += `Vi que você se cadastrou buscando sobre ${context}. Como posso te ajudar nessa pesquisa?`;

    return {
      action: "SEND",
      reason: "Sem histórico (Primeiro Contato)",
      message: msg
    };
  }

  // Analisa o histórico existente
  const { isRecent, mentionsCompetitor } = analyzeHistory(chatHistory);

  // 2. Regra: Mencionou concorrente ou falta de interesse
  if (mentionsCompetitor) {
    return {
      action: "SKIP",
      reason: "Cliente indicou que já comprou ou não tem interesse",
      message: ""
    };
  }

  // 3. Regra: Histórico Recente (hoje, ontem ou últimos dias da semana)
  if (isRecent) {
    return {
      action: "SKIP",
      reason: "Histórico muito recente (últimos dias)",
      message: ""
    };
  }

  // 4. Regra: Histórico Antigo (Reaquecimento)
  const greetings = ['Olá', 'Oi', 'Opa'];
  const greetings2 = ['tudo bem?', 'tudo certo?'];
  let msg = `${getRandomOption(greetings)} ${name}, ${getRandomOption(greetings2)} `;
  msg += `Aqui é o ${agentName} da Aptom Imóveis novamente. `;
  msg += `Faz um tempinho que conversamos sobre ${context}... você ainda está pesquisando imóveis na região ou já encontrou algo?`;

  return {
    action: "SEND",
    reason: "Histórico antigo (Reaquecimento)",
    message: msg
  };
}

module.exports = {
  generateMessage
};
