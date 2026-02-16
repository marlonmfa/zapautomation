const {
  randomDelayMs,
  withTimeout,
  ensureBrazilian13Digits,
  normalizeContactWithFix,
  normalizeContactId,
  resolveChatId,
  getLastMessageFromMe,
  getLastMessageFromMeWithDate,
  isTodayUnix,
  sendAndVerify,
  runBatch,
} = require('../batch-sender');

describe('randomDelayMs', () => {
  it('returns value between min and max inclusive', () => {
    for (let i = 0; i < 50; i++) {
      const v = randomDelayMs(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it('returns min when min >= max', () => {
    expect(randomDelayMs(5, 5)).toBe(5);
    expect(randomDelayMs(10, 3)).toBe(10);
  });
});

describe('ensureBrazilian13Digits', () => {
  it('returns as-is when already 13 digits', () => {
    expect(ensureBrazilian13Digits('5511999999999')).toBe('5511999999999');
  });
  it('inserts one 9 between 4th and 5th for 12 digits', () => {
    expect(ensureBrazilian13Digits('554799512346')).toBe('5547999512346');
  });
  it('inserts 9s until 13 digits for 11 digits', () => {
    expect(ensureBrazilian13Digits('554788954794')).toBe('5547988954794');
  });
});

describe('normalizeContactWithFix', () => {
  it('returns wasFixed true when length was < 13', () => {
    const r = normalizeContactWithFix('554799512346');
    expect(r.normalized).toBe('5547999512346@c.us');
    expect(r.wasFixed).toBe(true);
  });
  it('returns wasFixed false when already 13 digits', () => {
    const r = normalizeContactWithFix('5547991416694');
    expect(r.normalized).toBe('5547991416694@c.us');
    expect(r.wasFixed).toBe(false);
  });
});

describe('resolveChatId', () => {
  it('returns contactId when client has no getContactLidAndPhone', async () => {
    const client = {};
    expect(await resolveChatId(client, '5511999999999@c.us')).toBe('5511999999999@c.us');
  });

  it('returns lid when getContactLidAndPhone returns lid', async () => {
    const client = {
      getContactLidAndPhone: jest.fn().mockResolvedValue([{ lid: 'abc123@lid', pn: '5511999999999@c.us' }]),
    };
    expect(await resolveChatId(client, '5511999999999@c.us')).toBe('abc123@lid');
  });

  it('returns pn when lid is missing but pn present', async () => {
    const client = {
      getContactLidAndPhone: jest.fn().mockResolvedValue([{ lid: null, pn: '5511999999999@c.us' }]),
    };
    expect(await resolveChatId(client, '5511999999999@c.us')).toBe('5511999999999@c.us');
  });

  it('returns original contactId when getContactLidAndPhone throws', async () => {
    const client = {
      getContactLidAndPhone: jest.fn().mockRejectedValue(new Error('No LID')),
    };
    expect(await resolveChatId(client, '5511999999999@c.us')).toBe('5511999999999@c.us');
  });
});

describe('normalizeContactId', () => {
  it('adds @c.us when only digits', () => {
    expect(normalizeContactId('5511999999999')).toBe('5511999999999@c.us');
    expect(normalizeContactId('11999999999')).toBe('1199999999999@c.us');
  });

  it('strips non-digits when building id', () => {
    expect(normalizeContactId('+55 11 99999-9999')).toBe('5511999999999@c.us');
  });

  it('leaves already serialized id as-is when no digits only', () => {
    expect(normalizeContactId('5511999999999@c.us')).toBe('5511999999999@c.us');
  });

  it('trims whitespace before normalizing', () => {
    expect(normalizeContactId('  5511999999999  ')).toBe('5511999999999@c.us');
  });
});

describe('runBatch', () => {
  it('sends messages and returns sent/failed counts (skipVerify)', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const client = { sendMessage };

    const items = [
      { contact: '5511999999999', message: 'Hi' },
      { contact: '5521988888888', message: 'Bye' },
    ];

    const result = await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      skipVerify: true,
    });

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ contact: '5511999999999@c.us', success: true });
    expect(result.results[1]).toEqual({ contact: '5521988888888@c.us', success: true });
    expect(sendMessage).toHaveBeenCalledWith('5511999999999@c.us', 'Hi');
    expect(sendMessage).toHaveBeenCalledWith('5521988888888@c.us', 'Bye');
  });

  it('records failed sends (skipVerify)', async () => {
    const sendMessage = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Not registered'));
    const client = { sendMessage };

    const items = [
      { contact: '5511111111111', message: 'A' },
      { contact: '5522222222222', message: 'B' },
    ];

    const result = await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      skipVerify: true,
    });

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[1].success).toBe(false);
    expect(result.results[1].error).toBe('Not registered');
  });

  it('skips contact when skipIfEverSent (default) and we have any previous message from us', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const chat = {
      fetchMessages: jest.fn().mockResolvedValue([{ body: 'Any previous message', timestamp: 1000 }]),
    };
    const client = {
      sendMessage,
      getChatById: jest.fn().mockResolvedValue(chat),
    };
    const items = [{ contact: '5511999999999', message: 'Hi' }];

    const result = await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      skipVerify: true,
    });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({ contact: '5511999999999@c.us', success: true, skippedAlreadyReceived: true });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends when skipIfEverSent and chat has no previous message from us', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const chat = { fetchMessages: jest.fn().mockResolvedValue([]) };
    const client = { sendMessage, getChatById: jest.fn().mockResolvedValue(chat) };
    const items = [{ contact: '5511999999999', message: 'Hi' }];

    const result = await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      skipVerify: true,
    });

    expect(result.sent).toBe(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].skippedAlreadyReceived).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith('5511999999999@c.us', 'Hi');
  });

  it('skips contact when skipIfSentToday and last message from us was today (skipIfEverSent false)', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const todayStart = new Date();
    todayStart.setHours(12, 0, 0, 0);
    const timestampToday = Math.floor(todayStart.getTime() / 1000);
    const chat = {
      fetchMessages: jest.fn().mockResolvedValue([
        { body: 'Previous', timestamp: timestampToday },
      ]),
    };
    const client = {
      sendMessage,
      getChatById: jest.fn().mockResolvedValue(chat),
    };
    const items = [{ contact: '5511999999999', message: 'Hi' }];

    const result = await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      skipVerify: true,
      skipIfEverSent: false,
      skipIfSentToday: true,
    });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({ contact: '5511999999999@c.us', success: true, skippedSameDay: true });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends when skipIfSentToday but last message was not today (skipIfEverSent false)', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const timestampYesterday = Math.floor(yesterday.getTime() / 1000);
    const chat = {
      fetchMessages: jest.fn().mockResolvedValue([
        { body: 'Old', timestamp: timestampYesterday },
      ]),
    };
    const client = {
      sendMessage,
      getChatById: jest.fn().mockResolvedValue(chat),
    };
    const items = [{ contact: '5511999999999', message: 'Hi' }];

    const result = await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      skipVerify: true,
      skipIfEverSent: false,
      skipIfSentToday: true,
    });

    expect(result.sent).toBe(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].skippedSameDay).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith('5511999999999@c.us', 'Hi');
  });

  it('calls onProgress before each send', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const client = { sendMessage };
    const progressCalls = [];
    const items = [
      { contact: '5511111111111', message: 'A' },
      { contact: '5522222222222', message: 'B' },
    ];

    await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      skipVerify: true,
      onProgress: (current, total, contactId) => {
        progressCalls.push({ current, total, contactId });
      },
    });

    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0]).toEqual({ current: 1, total: 2, contactId: '5511111111111@c.us' });
    expect(progressCalls[1]).toEqual({ current: 2, total: 2, contactId: '5522222222222@c.us' });
  });

  it('fails and continues when sendMessage times out (skipVerify)', async () => {
    const sendMessage = jest.fn().mockImplementation(() => new Promise(() => {})); // never settles
    const client = { sendMessage };
    const items = [
      { contact: '5511111111111', message: 'A' },
      { contact: '5522222222222', message: 'B' },
    ];

    const result = await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      sendTimeoutMs: 50,
      skipVerify: true,
    });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.results[0].error).toMatch(/Send timeout/);
    expect(result.results[1].error).toMatch(/Send timeout/);
  });

  it('verifies last message and reattempts when mismatch (with mocked getChatById)', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    let calls1 = 0;
    let calls2 = 0;
    const getChatById = jest.fn().mockImplementation((id) => {
      if (id === '5511999999999@c.us') {
        calls1++;
        const body = calls1 === 1 ? '' : 'Hi';
        return Promise.resolve({
          fetchMessages: jest.fn().mockResolvedValue(body ? [{ body }] : []),
        });
      }
      if (id === '5521988888888@c.us') {
        calls2++;
        const body = calls2 === 1 ? '' : 'Bye';
        return Promise.resolve({
          fetchMessages: jest.fn().mockResolvedValue(body ? [{ body }] : []),
        });
      }
      return Promise.resolve({ fetchMessages: jest.fn().mockResolvedValue([]) });
    });
    const client = { sendMessage, getChatById };

    const items = [
      { contact: '5511999999999', message: 'Hi' },
      { contact: '5521988888888', message: 'Bye' },
    ];

    const result = await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      verifyDelayMs: 0,
      maxVerifyRetries: 1,
    });

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(getChatById).toHaveBeenCalledWith('5511999999999@c.us');
    expect(getChatById).toHaveBeenCalledWith('5521988888888@c.us');
  });

  it('reattempts when verification fails then succeeds on retry', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    let firstContactCalls = 0;
    let secondContactCalls = 0;
    const getChatById = jest.fn().mockImplementation((id) => {
      if (id === '5511999999999@c.us') {
        firstContactCalls++;
        const messages =
          firstContactCalls === 1
            ? []
            : [{ body: firstContactCalls >= 3 ? 'Hi' : 'wrong' }];
        return Promise.resolve({
          fetchMessages: jest.fn().mockResolvedValue(messages),
        });
      }
      if (id === '5521988888888@c.us') {
        secondContactCalls++;
        const messages = secondContactCalls === 1 ? [] : [{ body: 'Bye' }];
        return Promise.resolve({
          fetchMessages: jest.fn().mockResolvedValue(messages),
        });
      }
      return Promise.resolve({ fetchMessages: jest.fn().mockResolvedValue([]) });
    });
    const client = { sendMessage, getChatById };

    const items = [
      { contact: '5511999999999', message: 'Hi' },
      { contact: '5521988888888', message: 'Bye' },
    ];

    const result = await runBatch(client, items, {
      minDelayMs: 0,
      maxDelayMs: 0,
      verifyDelayMs: 0,
      maxVerifyRetries: 2,
      skipIfEverSent: false,
      skipIfSentToday: false,
    });

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results[0].retried).toBe(1);
    expect(result.results[1].retried).toBeUndefined();
  });
});

describe('isTodayUnix', () => {
  it('returns true for timestamp of today', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTodayUnix(now)).toBe(true);
  });
  it('returns false for timestamp of yesterday', () => {
    const yesterday = Math.floor(Date.now() / 1000) - 86400;
    expect(isTodayUnix(yesterday)).toBe(false);
  });
  it('returns false for invalid input', () => {
    expect(isTodayUnix(NaN)).toBe(false);
    expect(isTodayUnix(undefined)).toBe(false);
  });
});

describe('getLastMessageFromMeWithDate', () => {
  it('returns { body, timestamp } when chat has our messages', async () => {
    const chat = {
      fetchMessages: jest.fn().mockResolvedValue([
        { body: 'First', timestamp: 1000 },
        { body: 'Last', timestamp: 2000 },
      ]),
    };
    const client = { getChatById: jest.fn().mockResolvedValue(chat) };
    const result = await getLastMessageFromMeWithDate(client, '5511999999999@c.us');
    expect(result).toEqual({ body: 'Last', timestamp: 2000 });
  });
  it('returns null when chat has no messages from us', async () => {
    const chat = { fetchMessages: jest.fn().mockResolvedValue([]) };
    const client = { getChatById: jest.fn().mockResolvedValue(chat) };
    const result = await getLastMessageFromMeWithDate(client, '5511999999999@c.us');
    expect(result).toBeNull();
  });
  it('returns null when getChatById throws', async () => {
    const client = { getChatById: jest.fn().mockRejectedValue(new Error('No chat')) };
    const result = await getLastMessageFromMeWithDate(client, '5511999999999@c.us');
    expect(result).toBeNull();
  });
});

describe('getLastMessageFromMe', () => {
  it('returns last message body from our messages in chat', async () => {
    const getChatById = jest.fn().mockResolvedValue({
      fetchMessages: jest.fn().mockResolvedValue([{ body: 'first' }, { body: 'last' }]),
    });
    const client = { getChatById };
    const body = await getLastMessageFromMe(client, '5511999999999@c.us');
    expect(body).toBe('last');
    expect(getChatById).toHaveBeenCalledWith('5511999999999@c.us');
  });

  it('returns null when chat has no messages from us', async () => {
    const getChatById = jest.fn().mockResolvedValue({
      fetchMessages: jest.fn().mockResolvedValue([]),
    });
    const client = { getChatById };
    const body = await getLastMessageFromMe(client, '5511999999999@c.us');
    expect(body).toBeNull();
  });

  it('returns null when getChatById throws', async () => {
    const getChatById = jest.fn().mockRejectedValue(new Error('No chat'));
    const client = { getChatById };
    const body = await getLastMessageFromMe(client, '5511999999999@c.us');
    expect(body).toBeNull();
  });
});

describe('sendAndVerify', () => {
  it('returns success when send and verify match', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    let calls = 0;
    const getChatById = jest.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve({
        fetchMessages: jest.fn().mockResolvedValue(calls === 1 ? [] : [{ body: 'Hello' }]),
      });
    });
    const client = { sendMessage, getChatById };
    const result = await sendAndVerify(client, '5511999999999@c.us', 'Hello', {
      verifyDelayMs: 0,
      maxVerifyRetries: 0,
    });
    expect(result).toEqual({ success: true, retried: 0 });
  });

  it('returns success with alreadySent when last message already matches', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const getChatById = jest.fn().mockResolvedValue({
      fetchMessages: jest.fn().mockResolvedValue([{ body: 'Hello' }]),
    });
    const client = { sendMessage, getChatById };
    const result = await sendAndVerify(client, '5511999999999@c.us', 'Hello', {
      verifyDelayMs: 0,
      maxVerifyRetries: 0,
    });
    expect(result).toEqual({ success: true, alreadySent: true });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('returns failure when verification fails after max retries', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const getChatById = jest.fn().mockResolvedValue({
      fetchMessages: jest.fn().mockResolvedValue([{ body: 'other' }]),
    });
    const client = { sendMessage, getChatById };
    const result = await sendAndVerify(client, '5511999999999@c.us', 'Hello', {
      verifyDelayMs: 0,
      maxVerifyRetries: 1,
      checkAlreadySent: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Verification failed|does not match/);
  });
});

describe('withTimeout', () => {
  it('resolves when promise resolves before timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it('rejects when promise does not settle within timeout', async () => {
    const neverSettles = new Promise(() => {});
    await expect(withTimeout(neverSettles, 20)).rejects.toThrow(/Send timeout/);
  });
});
