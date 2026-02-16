const Database = require('better-sqlite3');
const {
  initSchema,
  insertTemplates,
  getRandomTemplates,
  countTemplates,
} = require('../db');

describe('db', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('initSchema', () => {
    it('creates message_templates table', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_templates'").get();
      expect(row).not.toBeUndefined();
      expect(row.name).toBe('message_templates');
    });
  });

  describe('insertTemplates', () => {
    it('inserts all bodies', () => {
      insertTemplates(db, ['Body A', 'Body B', 'Body C']);
      expect(countTemplates(db)).toBe(3);
    });

    it('does not duplicate same body on second insert', () => {
      insertTemplates(db, ['Body A', 'Body B']);
      insertTemplates(db, ['Body A', 'Body B']);
      expect(countTemplates(db)).toBe(2);
    });
  });

  describe('countTemplates', () => {
    it('returns 0 when empty', () => {
      expect(countTemplates(db)).toBe(0);
    });

    it('returns count after insert', () => {
      insertTemplates(db, ['A', 'B']);
      expect(countTemplates(db)).toBe(2);
    });
  });

  describe('getRandomTemplates', () => {
    beforeEach(() => {
      insertTemplates(db, ['Body 1', 'Body 2', 'Body 3', 'Body 4', 'Body 5']);
    });

    it('returns requested count', () => {
      const bodies = getRandomTemplates(db, 3);
      expect(bodies).toHaveLength(3);
      bodies.forEach((b) => expect(typeof b).toBe('string'));
    });

    it('returns only available when count > total', () => {
      const bodies = getRandomTemplates(db, 10);
      expect(bodies).toHaveLength(5);
    });

    it('returns no duplicates in single call', () => {
      const bodies = getRandomTemplates(db, 5);
      const set = new Set(bodies);
      expect(set.size).toBe(5);
    });
  });
});
