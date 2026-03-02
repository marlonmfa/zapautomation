/**
 * Load batch JSON and apply suppression list. Shared by run-batch.js and listen.js.
 */
const fs = require('fs');
const path = require('path');
const { getBatchSuppressionFile } = require('./config');

function normalizeContactDigits(contact) {
  return String(contact || '').replace(/@.*$/, '').replace(/\D/g, '');
}

function loadSuppressionSet() {
  const suppressionPath = getBatchSuppressionFile();
  if (!suppressionPath) return new Set();
  const absolutePath = path.isAbsolute(suppressionPath)
    ? suppressionPath
    : path.join(process.cwd(), suppressionPath);
  if (!fs.existsSync(absolutePath)) return new Set();
  try {
    const raw = fs.readFileSync(absolutePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((v) => normalizeContactDigits(v)).filter(Boolean));
  } catch (_) {
    return new Set();
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

module.exports = { loadBatchItems };
