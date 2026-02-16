describe('reply-suggestion', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  describe('normalizeMessage', () => {
    it('returns text message as content', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      jest.resetModules();
      const { normalizeMessage } = require('../services/reply-suggestion');
      const msg = { fromMe: false, body: 'Oi!', author: '5511999999999@c.us' };
      const transcribe = jest.fn();
      const result = await normalizeMessage(msg, transcribe);
      expect(result).toEqual({ fromMe: false, author: '5511999999999@c.us', content: 'Oi!' });
      expect(transcribe).not.toHaveBeenCalled();
    });

    it('trims and truncates long body', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      jest.resetModules();
      const { normalizeMessage } = require('../services/reply-suggestion');
      const long = 'a'.repeat(600);
      const msg = { fromMe: true, body: '  ' + long };
      const result = await normalizeMessage(msg, () => Promise.resolve(''));
      expect(result.content.length).toBe(501);
      expect(result.content.endsWith('…')).toBe(true);
    });

    it('uses transcribe for ptt and returns transcript as content', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      jest.resetModules();
      const { normalizeMessage } = require('../services/reply-suggestion');
      const msg = {
        fromMe: false,
        type: 'ptt',
        body: '',
        author: 'x',
        downloadMedia: jest.fn().mockResolvedValue({ data: Buffer.from('ogg').toString('base64'), mimetype: 'audio/ogg' }),
      };
      const transcribe = jest.fn().mockResolvedValue('Transcrição do áudio');
      const result = await normalizeMessage(msg, transcribe);
      expect(result).toEqual({ fromMe: false, author: 'x', content: 'Transcrição do áudio' });
      expect(transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'audio/ogg');
    });

    it('returns null for empty body text message', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      jest.resetModules();
      const { normalizeMessage } = require('../services/reply-suggestion');
      const result = await normalizeMessage({ fromMe: true, body: '   ' }, () => Promise.resolve(''));
      expect(result).toBeNull();
    });
  });

  describe('getConversationThread', () => {
    it('returns empty array when no messages', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const chat = { fetchMessages: jest.fn().mockResolvedValue([]) };
      jest.resetModules();
      const { getConversationThread } = require('../services/reply-suggestion');
      const thread = await getConversationThread(chat, 10);
      expect(thread).toEqual([]);
      expect(chat.fetchMessages).toHaveBeenCalledWith({ limit: 10 });
    });

    it('builds thread with Eu/Contato labels', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const chat = {
        fetchMessages: jest.fn().mockResolvedValue([
          { fromMe: false, body: 'Oi', author: '5511999999999@c.us' },
          { fromMe: true, body: 'Tudo bem?' },
        ]),
      };
      jest.resetModules();
      const { getConversationThread } = require('../services/reply-suggestion');
      const thread = await getConversationThread(chat, 5);
      expect(thread.length).toBe(2);
      expect(thread[0].role).toBe('user');
      expect(thread[0].content).toContain('Contato');
      expect(thread[0].content).toContain('Oi');
      expect(thread[1].role).toBe('assistant');
      expect(thread[1].content).toContain('Eu');
      expect(thread[1].content).toContain('Tudo bem?');
    });
  });

  describe('suggestReply', () => {
    it('throws if OPENAI_API_KEY is not set', async () => {
      delete process.env.OPENAI_API_KEY;
      const chat = { fetchMessages: jest.fn().mockResolvedValue([{ fromMe: false, body: 'Oi' }]) };
      jest.resetModules();
      const { suggestReply } = require('../services/reply-suggestion');
      await expect(suggestReply(chat)).rejects.toThrow('OPENAI_API_KEY is required');
    });

    it('returns fallback when no messages in thread', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const chat = { fetchMessages: jest.fn().mockResolvedValue([]) };
      jest.resetModules();
      const { suggestReply } = require('../services/reply-suggestion');
      const result = await suggestReply(chat);
      expect(result).toBe('Não há mensagens recentes para sugerir uma resposta.');
    });

    it('returns suggestion from OpenAI response', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const chat = {
        fetchMessages: jest.fn().mockResolvedValue([
          { fromMe: false, body: 'Quando podemos marcar?', author: 'x' },
          { fromMe: true, body: 'Amanhã às 15h' },
        ]),
      };
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Podemos marcar para depois de amanhã às 10h.' } }],
          }),
      });
      jest.resetModules();
      const { suggestReply } = require('../services/reply-suggestion');
      const result = await suggestReply(chat, { limit: 10 });
      expect(result).toBe('Podemos marcar para depois de amanhã às 10h.');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' },
        })
      );
    });

    it('throws on OpenAI API error', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const chat = { fetchMessages: jest.fn().mockResolvedValue([{ fromMe: false, body: 'Oi' }]) };
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('Server error') });
      jest.resetModules();
      const { suggestReply } = require('../services/reply-suggestion');
      await expect(suggestReply(chat)).rejects.toThrow('OpenAI API error 500');
    });
  });
});
