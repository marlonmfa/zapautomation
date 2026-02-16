/**
 * Send a WhatsApp message by opening the chat via the official send URL and
 * simulating user input (type + Enter). Avoids "número desconhecido" and
 * mimics human behavior to reduce blocking risk.
 *
 * When given a Browser (e.g. client.pupBrowser), opens a NEW tab so the main
 * WhatsApp Web page is never navigated (avoids "Execution context was destroyed").
 * When given a Page, uses that page directly (for standalone Puppeteer scripts).
 */

const WHATSAPP_WEB_SEND_URL = 'https://web.whatsapp.com/send';

/** Selectors for CHAT message input ONLY (footer of open conversation, NOT search box). */
const MESSAGE_INPUT_SELECTORS = [
  '#main footer div[contenteditable="true"][data-tab="10"]',
  '#main footer [contenteditable="true"]',
  'footer div[contenteditable="true"][data-tab="10"]',
  '[data-testid="conversation-compose-box-input"]',
  '#main .copyable-area footer [contenteditable="true"]',
  'div[contenteditable="true"][data-tab="10"]',
  'footer [contenteditable="true"]',
];

const DEFAULT_WAIT_AFTER_NAV_MS = 3500;
const DEFAULT_WAIT_INPUT_READY_MS = 300;
const DEFAULT_WAIT_AFTER_PASTE_MS = 600;
const DEFAULT_WAIT_AFTER_SEND_MS = 500;
const DEFAULT_NAV_TIMEOUT_MS = 15000;

/**
 * Wait for the message input to be visible and return it.
 * @param {import('puppeteer').Page} page
 * @param {number} timeoutMs
 * @returns {Promise<import('puppeteer').ElementHandle|null>}
 */
async function waitForMessageInput(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of MESSAGE_INPUT_SELECTORS) {
      try {
        const el = await page.$(sel);
        if (el) {
          const isChatInput = await el.evaluate((e) => {
            const style = window.getComputedStyle(e);
            if (style.display === 'none' || style.visibility === 'hidden' || !e.offsetParent) return false;
            const inSearch = !!e.closest('[data-testid="chat-list"]');
            const inFooter = !!e.closest('footer');
            const rect = e.getBoundingClientRect();
            const inBottomArea = rect.top > window.innerHeight * 0.35;
            return !inSearch && (inFooter || inBottomArea);
          }).catch(() => false);
          if (isChatInput) return el;
          await el.dispose();
        }
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

/**
 * Insert full message at once (no typing = no truncation or orthography errors).
 * Uses execCommand insertText. Verifies content was inserted before returning.
 */
async function insertFullMessage(page, input, message) {
  const text = String(message);
  await input.click();
  await page.evaluate((el, msg) => {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, msg);
  }, input, text);
  await new Promise((r) => setTimeout(r, 150));
  const inserted = await input.evaluate((el) => (el.innerText || el.textContent || '').trim());
  if (inserted.length < text.length * 0.5) {
    throw new Error('Message truncated: inserted ' + inserted.length + ' of ' + text.length);
  }
}

/**
 * Open the chat via the send URL and send the message by typing and pressing Enter.
 * Waits for the page and input to be ready so the full message is sent.
 * @param {import('puppeteer').Page} page - Puppeteer page (must be on WhatsApp Web / same origin)
 * @param {string} phoneDigits - E.164 digits only (e.g. "5511999999999")
 * @param {string} message - Text to send (full message including name)
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - Navigation + wait timeout (default 60000)
 * @param {number} [options.waitAfterNavMs] - Ms to wait after navigation (default 4500)
 * @param {number} [options.waitInputReadyMs] - Ms to wait after input is found before paste (default 400)
 * @param {number} [options.waitAfterPasteMs] - Ms to wait after pasting full message, before Enter (default 800)
 * @param {number} [options.waitAfterSendMs] - Ms to wait after pressing Enter (default 1000)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function openChatAndSendMessageOnPage(page, phoneDigits, message, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_NAV_TIMEOUT_MS;
  const waitAfterNavMs = options.waitAfterNavMs ?? DEFAULT_WAIT_AFTER_NAV_MS;
  const waitInputReadyMs = options.waitInputReadyMs ?? DEFAULT_WAIT_INPUT_READY_MS;
  const waitAfterPasteMs = options.waitAfterPasteMs ?? DEFAULT_WAIT_AFTER_PASTE_MS;
  const waitAfterSendMs = options.waitAfterSendMs ?? DEFAULT_WAIT_AFTER_SEND_MS;

  let digits = String(phoneDigits).replace(/\D/g, '');
  if (!digits.length) return { success: false, error: 'Invalid phone digits' };
  if (!digits.startsWith('55')) digits = '55' + digits;
  while (digits.length < 13 && digits.length >= 4) {
    digits = digits.slice(0, 4) + '9' + digits.slice(4);
  }

  const url = `${WHATSAPP_WEB_SEND_URL}/?phone=${digits}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  } catch (err) {
    return { success: false, error: err && (err.message || String(err)) };
  }

  await new Promise((r) => setTimeout(r, waitAfterNavMs));

  const input = await waitForMessageInput(page, Math.min(25000, timeoutMs - waitAfterNavMs - 3000));
  if (!input) {
    try {
      const hasAlert = await page.$('div[role="alertdialog"]').then((e) => !!e);
      if (hasAlert) await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 2000));
      let retry = null;
      for (const sel of MESSAGE_INPUT_SELECTORS) {
        retry = await page.$(sel);
        if (retry) break;
      }
      if (retry) {
        await new Promise((r) => setTimeout(r, waitInputReadyMs));
        await insertFullMessage(page, retry, message);
        await new Promise((r) => setTimeout(r, waitAfterPasteMs));
        await page.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, waitAfterSendMs));
        return { success: true };
      }
    } catch (e) {
      return { success: false, error: e && (e.message || String(e)) };
    }
    return { success: false, error: 'Message input not found after opening chat' };
  }

  try {
    await new Promise((r) => setTimeout(r, waitInputReadyMs));
    await insertFullMessage(page, input, message);
    await new Promise((r) => setTimeout(r, waitAfterPasteMs));
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, waitAfterSendMs));
    return { success: true };
  } catch (err) {
    return { success: false, error: err && (err.message || String(err)) };
  } finally {
    try {
      await input.dispose();
    } catch (_) {}
  }
}

/**
 * Send message by opening the chat URL. Accepts either a Browser or a Page.
 * When given a Browser (e.g. client.pupBrowser), opens a NEW tab so the main
 * WhatsApp Web tab is never navigated (avoids "Execution context was destroyed").
 * @param {import('puppeteer').Browser|import('puppeteer').Page} browserOrPage
 * @param {string} phoneDigits - E.164 digits only
 * @param {string} message - Full message text
 * @param {object} [options] - Same as openChatAndSendMessageOnPage
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function openChatAndSendMessage(browserOrPage, phoneDigits, message, options = {}) {
  const isBrowser = typeof browserOrPage.newPage === 'function';
  if (isBrowser) {
    let page;
    try {
      page = await browserOrPage.newPage();
      return await openChatAndSendMessageOnPage(page, phoneDigits, message, options);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (_) {}
      }
    }
  }
  return await openChatAndSendMessageOnPage(browserOrPage, phoneDigits, message, options);
}

module.exports = {
  WHATSAPP_WEB_SEND_URL,
  MESSAGE_INPUT_SELECTORS,
  waitForMessageInput,
  openChatAndSendMessage,
  openChatAndSendMessageOnPage,
};
