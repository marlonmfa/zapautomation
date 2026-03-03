/**
 * Convert a CSV (semicolon-separated) with "Telefone 1" column to batch JSON.
 * Usage: node scripts/csv-to-batch.js "path/to/file.csv" [output.json]
 */
const fs = require('fs');
const path = require('path');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/csv-to-batch.js "path/to/file.csv" [output.json]');
  process.exit(1);
}

const outPath = process.argv[3] || path.join(process.cwd(), 'batch-from-csv.json');
const defaultMessage = 'Oi, tudo bem? Aqui é o Lucas, da Aptom Imóveis. Vi seu interesse no apartamento da Rua Gastronômica, no centro de Joinville, e queria te ajudar com mais informações.';

function normalizePhone(val) {
  const digits = String(val || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  let d = digits;
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!d.startsWith('55')) d = '55' + d;
  if (d.length === 12 && d.startsWith('55')) d = d.slice(0, 4) + '9' + d.slice(4);
  if (d.length < 13) return null;
  return d;
}

const raw = fs.readFileSync(csvPath, 'utf8');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
if (lines.length < 2) {
  console.error('CSV has no data rows');
  process.exit(1);
}

const header = lines[0].split(';').map((c) => c.trim());
const tel1Index = header.findIndex((c) => /Telefone 1/i.test(c));
if (tel1Index === -1) {
  console.error('Column "Telefone 1" not found. Columns:', header.join(', '));
  process.exit(1);
}

const seen = new Set();
const items = [];
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(';');
  const tel = (cols[tel1Index] || '').trim();
  const phone = normalizePhone(tel);
  if (!phone || seen.has(phone)) continue;
  seen.add(phone);
  items.push({ contact: phone, message: defaultMessage });
}

fs.writeFileSync(outPath, JSON.stringify(items, null, 2), 'utf8');
console.log(`Written ${items.length} contacts to ${outPath}`);
