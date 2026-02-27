const fs = require('fs');
const path = require('path');
const { getFirstContactDecisionsLogPath } = require('../config');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveLogPath(p = getFirstContactDecisionsLogPath()) {
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function appendDecision(decision, logPath = getFirstContactDecisionsLogPath()) {
  const absolute = resolveLogPath(logPath);
  ensureDir(absolute);
  const row = {
    ts: new Date().toISOString(),
    ...decision,
  };
  fs.appendFileSync(absolute, JSON.stringify(row) + '\n', 'utf8');
}

function readDecisionMetrics(logPath = getFirstContactDecisionsLogPath()) {
  const absolute = resolveLogPath(logPath);
  if (!fs.existsSync(absolute)) {
    return { total: 0, autoReplies: 0, escalations: 0, ignored: 0, byIntent: {} };
  }
  const lines = fs.readFileSync(absolute, 'utf8').split('\n').filter(Boolean);
  const metrics = {
    total: 0,
    autoReplies: 0,
    escalations: 0,
    ignored: 0,
    byIntent: {},
  };
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      metrics.total++;
      if (row.action === 'reply') metrics.autoReplies++;
      else if (row.action === 'escalate') metrics.escalations++;
      else if (row.action === 'ignore') metrics.ignored++;
      const intent = row.intent || 'desconhecido';
      metrics.byIntent[intent] = (metrics.byIntent[intent] || 0) + 1;
    } catch (_) {}
  }
  return metrics;
}

module.exports = {
  appendDecision,
  readDecisionMetrics,
  resolveLogPath,
};
