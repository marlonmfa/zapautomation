# Lista de informações extraídas pelo agente de primeiro contato

O agente coleta as informações abaixo **uma por vez** antes de oferecer simulação ou encaminhar para o corretor. Todas são obrigatórias para considerar a qualificação completa.

---

## 1. Busca do cliente (5 itens)

| # | Campo (interno)   | Descrição para o agente |
|---|-------------------|--------------------------|
| 1 | **objetivo**     | Objetivo: morar ou investir |
| 2 | **tipoImovel**   | Tipo de imóvel (apartamento, casa, comercial, terreno) |
| 3 | **bairroRegiao** | Bairro ou região de interesse |
| 4 | **faixaValor**   | Faixa de valor que pretende investir |
| 5 | **prazo**        | Prazo para compra / quando pretende comprar |

---

## 2. Condições para simulação (4 itens)

| # | Campo (interno)     | Descrição para o agente |
|---|---------------------|--------------------------|
| 6 | **renda**          | Renda (para simulação de financiamento) |
| 7 | **valorEntrada**   | Valor de entrada que tem ou pretende dar |
| 8 | **usaFGTS**        | Se pretende usar FGTS (sim/não) |
| 9 | **carteiraAssinada** | Se tem mais de 3 anos com carteira assinada (CLT) (sim/não) |

---

## Quebras de gelo

O agente pode usar frases curtas antes da pergunta para a conversa não parecer formulário. Exemplos configurados no prompt:

- **Comentar o que a pessoa disse:** "Que bom que tá pensando nisso!", "Faz sentido.", "Isso ajuda bastante."
- **Transição leve:** "Só mais uma coisinha pra te orientar melhor...", "Pra eu já ir encaixando as opções...", "Me conta uma coisa rápida..."
- **Reconhecer:** "Ótimo, já anotei. Agora...", "Perfeito, com isso já consigo... Então..."

O agente alterna entre pergunta direta e quebra de gelo quando fizer sentido.

---

## Resumo

- **Total:** 9 informações.
- **Ordem:** o agente pergunta primeiro os 5 itens de busca; em seguida os 4 de condições.
- **Regra:** só após preencher as 9 o agente pode dizer que vai fazer a simulação e que um corretor entrará em contato.
- **Onde é usado:** `src/services/contact-memory.js` (campos) e `src/services/first-contact-agent.js` (labels, prompt e quebras de gelo).
