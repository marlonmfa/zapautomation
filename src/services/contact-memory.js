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

  const QUALIFICATION_FIELDS = ['objetivo', 'tipoImovel', 'bairroRegiao', 'faixaValor', 'prazo'];
  const CONDITION_FIELDS = ['renda', 'valorEntrada', 'usaFGTS', 'carteiraAssinada'];
  const ALL_QUALIFICATION_FIELDS = [...QUALIFICATION_FIELDS, ...CONDITION_FIELDS];
  const MIN_QUALIFICATION_FIELDS = 4;
  const MIN_CONDITION_FIELDS = 2;

  const defaultQualification = () => ({
    objetivo: '', tipoImovel: '', bairroRegiao: '', faixaValor: '', prazo: '',
    renda: '', valorEntrada: '', usaFGTS: '', carteiraAssinada: '',
  });

  function getContact(contactId) {
    const existing = store.contacts[contactId];
    if (existing) {
      if (!existing.qualification) existing.qualification = defaultQualification();
      else {
        CONDITION_FIELDS.forEach((f) => {
          if (existing.qualification[f] === undefined) existing.qualification[f] = '';
        });
      }
      if (existing.handedOff === undefined) existing.handedOff = false;
      if (existing.scriptOpenIndex === undefined) existing.scriptOpenIndex = 0;
      return existing;
    }
    const base = {
      contactId,
      state: 'novo_contato',
      lastIntent: 'desconhecido',
      lastConfidence: 0,
      lastIncomingMessageId: '',
      lastOutgoingMessageId: '',
      lastAction: '',
      doNotContact: false,
      handedOff: false,
      scriptOpenIndex: 0,
      qualification: defaultQualification(),
      summary: '',
      pendingFields: [],
      recentMessages: [],
      updatedAt: nowIso(),
      createdAt: nowIso(),
    };
    store.contacts[contactId] = base;
    return base;
  }

  function updateQualification(contactId, field, value) {
    const contact = getContact(contactId);
    if (ALL_QUALIFICATION_FIELDS.includes(field) && value != null && String(value).trim()) {
      contact.qualification = contact.qualification || defaultQualification();
      contact.qualification[field] = String(value).trim().slice(0, 200);
      contact.updatedAt = nowIso();
    }
  }

  function getQualificationProgress(contactId) {
    const contact = getContact(contactId);
    const q = contact.qualification || {};
    const collected = QUALIFICATION_FIELDS.filter((f) => q[f] && String(q[f]).trim());
    const missing = QUALIFICATION_FIELDS.filter((f) => !q[f] || !String(q[f]).trim());
    return { collected, missing };
  }

  function getConditionProgress(contactId) {
    const contact = getContact(contactId);
    const q = contact.qualification || {};
    const collected = CONDITION_FIELDS.filter((f) => q[f] && String(q[f]).trim());
    const missing = CONDITION_FIELDS.filter((f) => !q[f] || !String(q[f]).trim());
    return { collected, missing };
  }

  function isQualificationComplete(contactId) {
    const search = getQualificationProgress(contactId);
    const cond = getConditionProgress(contactId);
    return search.collected.length >= MIN_QUALIFICATION_FIELDS && cond.collected.length >= MIN_CONDITION_FIELDS;
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
    updateQualification,
    getQualificationProgress,
    getConditionProgress,
    isQualificationComplete,
    QUALIFICATION_FIELDS,
    CONDITION_FIELDS,
    MIN_QUALIFICATION_FIELDS,
    MIN_CONDITION_FIELDS,
    persist,
  };
}

module.exports = {
  createMemoryService,
  loadStore,
  saveStore,
};
