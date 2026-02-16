# Zap Automation

WhatsApp Web automation built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js). It supports:

- **Persistent sessions**: Store auth per session (same phone/user = no QR scan every time).
- **Chat listeners**: Listen to messages in groups and private chats.
- **Batch sending**: Send messages to many contacts with random delays between each send.

## Requirements

- Node.js >= 18
- WhatsApp account (phone with WhatsApp Web / linked devices)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and set SESSION_ID (e.g. "my-phone") to identify this session.
```

For `npm run session` (QR scan) and sending/listening, a browser is required. The app uses Puppeteer’s Chrome if available; otherwise it **falls back to system Chrome** (e.g. `/Applications/Google Chrome.app` on macOS). Set `PUPPETEER_EXECUTABLE_PATH` in `.env` to override.

## Session (create test session / store auth)

On **first run** you need to link the device (scan QR or use pairing code). Auth is stored by `SESSION_ID` so the same user with the same phone does not need to scan again.

```bash
npm run session
```

- Opens a browser window with the pairing QR code; scan it with WhatsApp (Linked Devices). The QR is shown in the browser instead of the terminal.
- After success, session data is saved under `.wwebjs_auth` (or `AUTH_DATA_PATH`).
- Next time you run any script with the **same** `SESSION_ID`, it will reuse the session and not ask for QR.

Use a **unique** `SESSION_ID` per phone/user (e.g. `SESSION_ID=my-phone` or `SESSION_ID=user123`).

## Listen to chats

Listen to all incoming messages (groups and private):

```bash
npm run listen
```

Ensure you have already run `npm run session` so the client is authenticated.

## Batch send

Send messages to multiple contacts with **random delays** between each message (to look more natural). Delays are between `BATCH_DELAY_MIN_MS` and `BATCH_DELAY_MAX_MS` (default 5–30 seconds).

1. Create a JSON file with an array of `{ "contact": "5511999999999", "message": "Your text" }`.
2. Run:

```bash
npm run batch -- batch-example.json
```

Contact can be phone only (e.g. `5511999999999`) or full id (`5511999999999@c.us`).

### Batch from CSV (e.g. batch_lucas leads)

For Meta/Instagram lead CSVs (UTF-16 tab-separated) with `full name` and `phone` columns:

1. **Seed message templates** (once): templates are stored in SQLite and picked randomly without reuse per run.

   ```bash
   npm run seed-templates
   ```

2. **Build batch JSON** from a leads CSV. Contacts are normalized to Brazil WhatsApp format (55 + DDD + number). Each contact gets a different message variation.

   ```bash
   npm run build-batch -- "batch_lucas/[VIDEO 01][DIA]_Leads_2026-02-08_2026-02-11 (1).csv" batch_lucas/batch-output.json
   ```

3. **Send the batch**:

   ```bash
   npm run batch -- batch_lucas/batch-output.json
   ```

Message format: *"Boa tarde {firstName}, tudo bem?"* plus a random body about the lançamento on Rua Visconde de Taunay (next to Zum). Templates live in `src/message-templates.js` and in the SQLite DB under `data/messages.db`.

## Environment variables

| Variable | Description |
|----------|-------------|
| `SESSION_ID` | Session identifier. Same value = same stored auth (default: `default`). |
| `BATCH_DELAY_MIN_MS` | Min delay between batch messages in ms (default: 5000). |
| `BATCH_DELAY_MAX_MS` | Max delay between batch messages in ms (default: 30000). |
| `AUTH_DATA_PATH` | Directory for session data (default: `.wwebjs_auth`). |
| `PUPPETEER_EXECUTABLE_PATH` | Optional. Path to Chrome/Chromium. If unset, system Chrome is auto-detected when Puppeteer’s cache has no browser. |

## If WhatsApp doesn’t connect

1. **Run from project root** so the session folder `.wwebjs_auth` is found (or set `AUTH_DATA_PATH` in `.env`).
2. **Create a session first**: `npm run session` — scan the QR with WhatsApp (Linked Devices). Then run batch/listen with the same `SESSION_ID`.
3. **Connection check**: `npm run check-connection` — prints session path, Chrome path, and tries to connect; reports “Connection OK”, “QR needed”, or the error (e.g. Chrome not found, auth failure).
4. **Chrome not found**: Copy `.env.example` to `.env` and set `PUPPETEER_EXECUTABLE_PATH` to your Chrome binary (e.g. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS). Or use `npm run session:open` / `npm run batch:open` which set it for you.
5. **“Already running”**: Close any other WhatsApp Web window or script using the same session, then try again.

## Project layout

- `src/client.js` – WhatsApp client with LocalAuth (session persistence).
- `src/config.js` – Loads config from `.env`.
- `src/listeners.js` – Attach message listeners for groups and private chats.
- `src/batch-sender.js` – Batch send with random delays.
- `src/scripts/create-session.js` – Create/store session (QR scan once per SESSION_ID). `src/qr-server.js` – Local server that shows the QR in a browser window.
- `src/scripts/run-batch.js` – Run batch from JSON file.
- `src/scripts/seed-message-templates.js` – Seed SQLite with message template bodies.
- `src/scripts/build-batch-from-csv.js` – Build batch JSON from leads CSV (Brazil WhatsApp + random messages).
- `src/scripts/listen.js` – Run listeners.
- `src/scripts/check-connection.js` – Diagnose connection (session, Chrome, ready/QR/failure).
- `src/db.js` – SQLite helpers for message templates.
- `src/message-templates.js` – Template body variations (Visconde de Taunay / Zum).
- `src/batch-lucas-utils.js` – Phone normalization and first-name helpers for batch_lucas.

## Disclaimer

This project is not affiliated with WhatsApp. Using automation may violate WhatsApp’s terms of service; use at your own risk.
