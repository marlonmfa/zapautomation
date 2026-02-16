/**
 * Attach message listeners to a WhatsApp client for both group and private chats.
 * @param {Client} client - whatsapp-web.js Client
 * @param {object} [handlers]
 * @param {function} [handlers.onMessage] - (msg) => {} for every message (groups + private)
 * @param {function} [handlers.onPrivateMessage] - (msg) => {} only private chats
 * @param {function} [handlers.onGroupMessage] - (msg) => {} only group chats
 * @param {function} [handlers.onMessageCreate] - (msg) => {} message_create event (includes own messages)
 */
function attachListeners(client, handlers = {}) {
  const { onMessage, onPrivateMessage, onGroupMessage, onMessageCreate } = handlers;

  client.on('message', async (msg) => {
    if (onMessage) onMessage(msg);
    try {
      const chat = await msg.getChat();
      if (chat.isGroup) {
        if (onGroupMessage) onGroupMessage(msg);
      } else {
        if (onPrivateMessage) onPrivateMessage(msg);
      }
    } catch (err) {
      console.error('[listeners] getChat error:', err.message);
    }
  });

  if (onMessageCreate) {
    client.on('message_create', async (msg) => {
      onMessageCreate(msg);
    });
  }
}

module.exports = { attachListeners };
