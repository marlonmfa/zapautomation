/**
 * Fecha à força todas as janelas do Google Chrome e abre a análise com Puppeteer (navegador visível).
 * Uso: node src/scripts/analyze-with-open.js <número> [relatorio.csv]
 */

process.env.KILL_WA_FORCE = '1';
process.env.ANALYZE_OPEN = '1';

console.log('Fechando Chrome...');
require('./kill-wa-browser.js');
console.log('Aguardando 5s para liberar a sessão...');

const args = process.argv.slice(2);
process.argv = [process.argv[0], require('path').join(__dirname, 'analyze-conversations.js'), ...args, '--open'];

setTimeout(() => {
  require('./analyze-conversations.js');
}, 5000);
