/**
 * SQLite database for message templates. Used to store and pick random
 * message variations for batch WhatsApp sends (no reuse in same batch).
 */
const Database = require('better-sqlite3');
const path = require('path');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'messages.db');

/**
 * @param {string} [dbPath]
 * @returns {import('better-sqlite3').Database}
 */
function openDb(dbPath = DEFAULT_DB_PATH) {
  return new Database(dbPath);
}

/**
 * Create schema if not exists.
 * @param {import('better-sqlite3').Database} db
 */
function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_message_templates_id ON message_templates(id);
  `);
}

/**
 * Insert message template bodies. Idempotent if same body exists (we don't duplicate).
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} bodies
 */
function insertTemplates(db, bodies) {
  const insert = db.prepare(
    'INSERT INTO message_templates (body) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM message_templates WHERE body = ?)'
  );
  const insertMany = db.transaction((list) => {
    for (const body of list) {
      insert.run(body, body);
    }
  });
  insertMany(bodies);
}

/**
 * Get all template bodies in random order, limited to count (for no-reuse assignment).
 * @param {import('better-sqlite3').Database} db
 * @param {number} count
 * @returns {string[]}
 */
function getRandomTemplates(db, count) {
  const rows = db.prepare('SELECT body FROM message_templates ORDER BY RANDOM() LIMIT ?').all(count);
  return rows.map((r) => r.body);
}

/**
 * Count templates in DB.
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
function countTemplates(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM message_templates').get();
  return row.n;
}

module.exports = {
  DEFAULT_DB_PATH,
  openDb,
  initSchema,
  insertTemplates,
  getRandomTemplates,
  countTemplates,
};
