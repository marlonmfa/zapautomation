/**
 * Print first-contact agent metrics from decision logs.
 * Usage: node src/scripts/report-first-contact.js
 */
const { readDecisionMetrics, resolveLogPath } = require('../services/decision-logger');

const metrics = readDecisionMetrics();
const logPath = resolveLogPath();

console.log('--- First Contact Metrics ---');
console.log('Log path:', logPath);
console.log('Total decisions:', metrics.total);
console.log('Auto replies:', metrics.autoReplies);
console.log('Escalations:', metrics.escalations);
console.log('Ignored:', metrics.ignored);
console.log('Intents:');
for (const [intent, count] of Object.entries(metrics.byIntent)) {
  console.log(`  - ${intent}: ${count}`);
}
