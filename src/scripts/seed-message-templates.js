/**
 * Seed the SQLite database with message template bodies (Visconde de Taunay / Zum).
 * Run once: node src/scripts/seed-message-templates.js
 * Creates data/messages.db if it does not exist.
 */
const fs = require('fs');
const path = require('path');
const { openDb, initSchema, insertTemplates, countTemplates } = require('../db');
const { MESSAGE_BODIES } = require('../message-templates');

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'messages.db');
const db = openDb(dbPath);

initSchema(db);
insertTemplates(db, MESSAGE_BODIES);
const count = countTemplates(db);

console.log(`Seeded ${count} message templates to ${dbPath}`);
db.close();
