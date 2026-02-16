/**
 * Build a batch JSON from a leads CSV (e.g. from batch_lucas).
 * - Parses CSV (UTF-16 tab-separated) for full_name and phone
 * - Normalizes phone to Brazil WhatsApp format (55 + DDD + number)
 * - Picks one random message template per contact (no reuse) from SQLite
 * - Output: [{ contact, message }, ...] with message "Boa tarde {firstName}, tudo bem?\n\n{body}"
 *
 * Usage: node src/scripts/build-batch-from-csv.js <path-to-leads.csv> [output.json]
 * Example: node src/scripts/build-batch-from-csv.js "batch_lucas/[VIDEO 01][DIA]_Leads_2026-02-08_2026-02-11 (1).csv" batch_lucas/batch-output.json
 */
const fs = require('fs');
const path = require('path');
const { openDb, getRandomTemplates, countTemplates } = require('../db');
const { toBrazilWhatsApp, firstName, isExcludedContact } = require('../batch-lucas-utils');

const csvPath = process.argv[2];
const outPath = process.argv[3];

if (!csvPath) {
  console.error('Usage: node src/scripts/build-batch-from-csv.js <path-to-leads.csv> [output.json]');
  process.exit(1);
}

const absoluteCsvPath = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
if (!fs.existsSync(absoluteCsvPath)) {
  console.error('CSV file not found:', absoluteCsvPath);
  process.exit(1);
}

/**
 * Parse UTF-16 LE tab-separated CSV (e.g. Meta leads export); return rows as arrays of columns.
 * @param {string} filePath - path to CSV
 * @returns {string[][]}
 */
function parseCsvRows(filePath) {
  let content = fs.readFileSync(filePath, 'utf16le');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  return lines.map((line) => line.split('\t').map((cell) => cell.replace(/^"|"$/g, '').trim()));
}

function main() {
  const rows = parseCsvRows(absoluteCsvPath);
  if (rows.length < 2) {
    console.error('CSV has no header or data rows.');
    process.exit(1);
  }

  const header = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const nameCol = header.findIndex((h) => h === 'full_name' || (h.includes('full') && h.includes('name')));
  let phoneCol = header.findIndex((h) => h === 'phone');
  if (phoneCol < 0 && header.length > 0 && rows[1]) {
    const last = header.length - 1;
    if (/^[p+]?\s*[\d+]/.test(String(rows[1][last] || '').trim())) phoneCol = last;
  }

  if (nameCol < 0 || phoneCol < 0) {
    console.error('Could not find "full name" or "phone" column. Header:', header);
    process.exit(1);
  }

  const contacts = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fullName = row[nameCol] || '';
    if (isExcludedContact(fullName)) continue;
    const phoneRaw = row[phoneCol] || '';
    const phone = toBrazilWhatsApp(phoneRaw);
    if (!phone || phone.length < 12) continue;
    contacts.push({ fullName, phone });
  }

  if (contacts.length === 0) {
    console.error('No valid contacts (Brazil WhatsApp format) found in CSV.');
    process.exit(1);
  }

  const dataDir = path.join(process.cwd(), 'data');
  const dbPath = path.join(dataDir, 'messages.db');
  if (!fs.existsSync(dbPath)) {
    console.error('Database not found. Run: node src/scripts/seed-message-templates.js');
    process.exit(1);
  }

  const db = openDb(dbPath);
  const totalTemplates = countTemplates(db);
  if (totalTemplates < contacts.length) {
    db.close();
    console.error(`Not enough message templates (${totalTemplates}). Need at least ${contacts.length}. Add more in src/message-templates.js and re-seed.`);
    process.exit(1);
  }

  const bodies = getRandomTemplates(db, contacts.length);
  db.close();

  const items = contacts.map((c, i) => {
    const first = firstName(c.fullName);
    const greeting = `Boa tarde ${first}, tudo bem?`;
    const message = `${greeting}\n\n${bodies[i]}`;
    return { contact: c.phone, message };
  });

  const outputPath = outPath
    ? (path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath))
    : path.join(path.dirname(absoluteCsvPath), 'batch-output.json');

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(items, null, 2), 'utf8');

  console.log(`Built ${items.length} contacts -> ${outputPath}`);
}

main();
