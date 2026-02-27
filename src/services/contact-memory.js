const fs = require('fs');
const path = require('path');
const { getFirstContactMemoryPath } = require('../config');

const MAX_RECENT_MESSAGES = 30;

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function loadStore(memoryPath = getFirstContactMemoryPath()) {
  const absolute = path.isAbsolute(memoryPath) ? memoryPath : path.join(process.cwd(), memoryPath);
  try {
    if (!fs.existsSync(absolute)) return { version: 1, contacts: {} };
    const raw = fs.readFileSync(absolute, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.contacts) return { version: 1, contacts: {} };
    return data;
  } catch {
    return { version: 1, contacts: {} };
  }
}

function saveStore(store, memoryPath = getFirstContactMemoryPath()) {
  const absolute = path.isAbsolute(memoryPath) ? memoryPath : path.join(process.cwd(), memoryPath);
  ensureDir(absolute);
  fs.writeFileSync(absolute, JSON.stringify(store, null, 2), 'utf8');
}

function createMemoryService(memoryPath = getFirstContactMemoryPath()) {
  const store = loadStore(memoryPath);

  function getContact(contactId) {
    const existing = store.contacts[contactId];
    if (existing) return existing;
    const base = {
      contactId,
      state: 'novo_contato',
      lastIntent: 'desconhecido',
      lastConfidence: 0,
      lastIncomingMessageId: '',
      lastOutgoingMessageId: '',
      lastAction: '',
      doNotContact: false,
      summary: '',
      pendingFields: [],
      recentMessages: [],
      updatedAt: nowIso(),
      createdAt: nowIso(),
    };
    store.contacts[contactId] = base;
    return base;
  }

  function appendMessage(contactId, entry) {
    const contact = getContact(contactId);
    contact.recentMessages.push({
      role: entry.role,
      content: String(entry.content || '').slice(0, 800),
      ts: entry.ts || nowIso(),
      messageId: entry.messageId || '',
    });
    if (contact.recentMessages.length > MAX_RECENT_MESSAGES) {
      contact.recentMessages = contact.recentMessages.slice(-MAX_RECENT_MESSAGES);
    }
    contact.updatedAt = nowIso();
  }

  function updateContact(contactId, patch) {
    const contact = getContact(contactId);
    Object.assign(contact, patch || {});
    contact.updatedAt = nowIso();
    return contact;
  }

  function updateSummary(contactId) {
    const contact = getContact(contactId);
    const lastUser = [...contact.recentMessages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...contact.recentMessages].reverse().find((m) => m.role === 'assistant');
    const summaryParts = [];
    if (contact.state) summaryParts.push(`estado=${contact.state}`);
    if (contact.lastIntent) summaryParts.push(`intencao=${contact.lastIntent}`);
    if (lastUser) summaryParts.push(`ultimo_cliente="${lastUser.content.slice(0, 120)}"`);
    if (lastAssistant) summaryParts.push(`ultima_resposta="${lastAssistant.content.slice(0, 120)}"`);
    if (Array.isArray(contact.pendingFields) && contact.pendingFields.length > 0) {
      summaryParts.push(`pendencias=${contact.pendingFields.join(',')}`);
    }
    contact.summary = summaryParts.join(' | ');
    contact.updatedAt = nowIso();
    return contact.summary;
  }

  function persist() {
    saveStore(store, memoryPath);
  }

  return {
    store,
    getContact,
    appendMessage,
    updateContact,
    updateSummary,
    persist,
  };
}

module.exports = {
  createMemoryService,
  loadStore,
  saveStore,
};
