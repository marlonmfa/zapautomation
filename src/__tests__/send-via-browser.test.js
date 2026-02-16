const {
  WHATSAPP_WEB_SEND_URL,
  openChatAndSendMessage,
  waitForMessageInput,
} = require('../send-via-browser');

describe('send-via-browser', () => {
  it('exports WHATSAPP_WEB_SEND_URL', () => {
    expect(WHATSAPP_WEB_SEND_URL).toBe('https://web.whatsapp.com/send');
  });

  it('openChatAndSendMessage returns error when phone digits are empty', async () => {
    const page = {};
    const result = await openChatAndSendMessage(page, '', 'Hi');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('openChatAndSendMessage returns error when page.goto fails', async () => {
    const page = {
      goto: jest.fn().mockRejectedValue(new Error('Navigation failed')),
    };
    const result = await openChatAndSendMessage(page, '5511999999999', 'Hi', { waitAfterNavMs: 0 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Navigation failed');
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining('phone=5511999999999'),
      expect.any(Object)
    );
  });

  it('openChatAndSendMessage with browser creates new page and closes it', async () => {
    const fakePage = {
      goto: jest.fn().mockResolvedValue(),
      $: jest.fn().mockResolvedValue(null),
      keyboard: { press: jest.fn().mockResolvedValue() },
    };
    const browser = {
      newPage: jest.fn().mockResolvedValue(fakePage),
    };
    const closeSpy = jest.fn().mockResolvedValue();
    fakePage.close = closeSpy;

    const result = await openChatAndSendMessage(browser, '5511999999999', 'Hi', {
      timeoutMs: 2000,
      waitAfterNavMs: 0,
      waitInputReadyMs: 0,
    });
    expect(browser.newPage).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Message input not found');
  }, 10000);

  it('waitForMessageInput returns null when selector never appears', async () => {
    const page = { $: jest.fn().mockResolvedValue(null) };
    const el = await waitForMessageInput(page, 500);
    expect(el).toBeNull();
  });
});
