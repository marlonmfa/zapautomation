/**
 * From a batch JSON, find contacts with < 13 digits, fix them (add 9 between 4th and 5th digit),
 * write a resend batch with only those contacts (corrected numbers) and run the batch.
 * Usage: node src/scripts/resend-fixed-numbers.js [path-to-batch.json] [--dry-run]
 * Default batch: batch_lucas/batch-output.json
 * Output: batch_lucas/batch-resend-fixed.json then runs batch on it (unless --dry-run).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { normalizeContactWithFix } = require('../batch-sender');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const batchPath = argv.filter((a) => a !== '--dry-run')[0] || path.join(process.cwd(), 'batch_lucas', 'batch-output.json');
const absolutePath = path.isAbsolute(batchPath) ? batchPath : path.join(process.cwd(), batchPath);
const outDir = path.dirname(absolutePath);
const resendPath = path.join(outDir, 'batch-resend-fixed.json');

let items;
try {
  const raw = fs.readFileSync(absolutePath, 'utf8');
  items = JSON.parse(raw);
} catch (e) {
  console.error('Read error:', e.message);
  process.exit(1);
}

if (!Array.isArray(items) || items.length === 0) {
  console.error('Batch file must be a non-empty array of { contact, message }.');
  process.exit(1);
}

const resendItems = [];
for (const { contact, message } of items) {
  const { normalized, wasFixed } = normalizeContactWithFix(contact);
  if (wasFixed) {
    const digitsOnly = normalized.replace('@c.us', '');
    resendItems.push({ contact: digitsOnly, message });
  }
}

if (resendItems.length === 0) {
  console.log('No contacts needed the 13-digit fix. Nothing to resend.');
  process.exit(0);
}

fs.writeFileSync(resendPath, JSON.stringify(resendItems, null, 2), 'utf8');
console.log(`Fixed ${resendItems.length} contact(s); wrote ${resendPath}`);

if (dryRun) {
  console.log('Dry run: skipping batch. Run: npm run resend-fixed (or batch:open -- batch_lucas/batch-resend-fixed.json)');
  process.exit(0);
}

console.log('Running batch to resend...');
const runBatchPath = path.join(__dirname, 'run-batch.js');
const child = spawn(
  process.execPath,
  [runBatchPath, resendPath],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  }
);
child.on('close', (code) => process.exit(code ?? 0));
