/**
 * Load batch JSON and apply suppression list. Shared by run-batch.js and listen.js.
 */
const fs = require('fs');
const path = require('path');
const { getBatchSuppressionFile } = require('./config');

const DEFAULT_SENT_LIST_PATH = 'data/batch-sent.json';

function normalizeContactDigits(contact) {
  return String(contact || '').replace(/@.*$/, '').replace(/\D/g, '');
}

function loadSuppressionSet() {
  const sentPath = path.isAbsolute(DEFAULT_SENT_LIST_PATH) ? DEFAULT_SENT_LIST_PATH : path.join(process.cwd(), DEFAULT_SENT_LIST_PATH);
  let set = new Set();
  if (fs.existsSync(sentPath)) {
    try {
      const raw = fs.readFileSync(sentPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) parsed.forEach((v) => set.add(normalizeContactDigits(v)));
    } catch (_) {}
  }
  const suppressionPath = getBatchSuppressionFile();
  if (suppressionPath) {
    const absolutePath = path.isAbsolute(suppressionPath) ? suppressionPath : path.join(process.cwd(), suppressionPath);
    if (fs.existsSync(absolutePath)) {
      try {
        const raw = fs.readFileSync(absolutePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) parsed.forEach((v) => set.add(normalizeContactDigits(v)));
      } catch (_) {}
    }
  }
  return set;
}

/**
 * Add contact to the sent list (removed from next batch runs). Call after successful dispatch.
 * @param {string} contactId - e.g. 5547999793813@c.us
 */
function addToSentList(contactId) {
  const digits = normalizeContactDigits(contactId);
  if (!digits) return;
  const sentPath = path.isAbsolute(DEFAULT_SENT_LIST_PATH) ? DEFAULT_SENT_LIST_PATH : path.join(process.cwd(), DEFAULT_SENT_LIST_PATH);
  let list = [];
  try {
    if (fs.existsSync(sentPath)) {
      const raw = fs.readFileSync(sentPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed.map((v) => normalizeContactDigits(v)).filter(Boolean);
    }
  } catch (_) {}
  if (list.includes(digits)) return;
  list.push(digits);
  list.sort();
  try {
    fs.mkdirSync(path.dirname(sentPath), { recursive: true });
    fs.writeFileSync(sentPath, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.warn('[batch] Não foi possível salvar em lista de enviados:', err.message);
  }
}

/**
 * Load and prepare batch items from a JSON file.
 * @param {string} batchPath - Path to batch JSON (relative to cwd or absolute)
 * @returns {{ items: Array, absolutePath: string }}
 */
function loadBatchItems(batchPath) {
  const absolutePath = path.isAbsolute(batchPath) ? batchPath : path.join(process.cwd(), batchPath);
  if (!fs.existsSync(absolutePath)) throw new Error('Batch file not found: ' + absolutePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const list = JSON.parse(raw);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('Batch file must be a non-empty array of { contact, message }');
  }
  const supSet = loadSuppressionSet();
  const items = list.map((item) => {
    const digits = normalizeContactDigits(item && item.contact);
    return { ...item, suppressed: digits ? supSet.has(digits) : false };
  });
  return { items, absolutePath };
}

module.exports = { loadBatchItems, addToSentList };
