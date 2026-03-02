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

### Segurança da chave OpenAI

- **Nunca** coloque sua chave real da OpenAI em prints, commits ou mensagens compartilhadas.
- Se uma chave já foi exposta (por exemplo, colada em um chat), acesse o painel da OpenAI, **revogue essa chave** e gere uma nova.
- Mantenha a chave apenas no arquivo `.env` local (que não deve ser versionado) ou em um cofre de segredos.

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

### First-contact attendant (auto)

You can enable an automatic first-contact attendant for private chats (question triage + safe escalation):

1. Set in `.env`:
   - `ENABLE_FIRST_CONTACT_AGENT=true`
   - `OPENAI_API_KEY=...` (obrigatório para respostas com IA)
   - (opcional) `AI_KNOWLEDGE_PDF=knowledge/apresentacao-imovel.pdf` — PDF de apresentação do imóvel para a IA usar como base nas respostas (veja pasta `knowledge/`).
2. Com isso ativo, o agente assume o **primeiro atendimento imobiliário em Joinville**, seguindo estas regras:
   - se apresenta como corretor, em tom simples e educado;
   - confirma tipo de imóvel, faixa de valor e bairros/regiões da cidade;
   - responde dúvidas iniciais sobre financiamento e documentação;
   - quando o cliente pede visita, liga ou demonstra forte interesse, o caso é marcado para humano.
3. Run:

```bash
npm run listen
```

When enabled, the listener:
- keeps per-contact memory in `data/first-contact-memory.json` (para testar de novo com o mesmo número, apague o contato nesse arquivo ou o arquivo inteiro)
- auto-replies only when confidence/safety checks pass
- escalates ambiguous/sensitive cases
- writes structured decisions to `data/first-contact-decisions.jsonl`

For a **small pilot with AI attendant + batch send**, a typical flow is:

```bash
# 1) Gerar JSON da lista a partir do CSV dos leads
npm run build-batch -- "batch_lucas/[VIDEO 01][DIA]_Leads_2026-02-08_2026-02-11 (1).csv" batch_lucas/batch-output.json

# 2) Rodar um piloto de envio (até ~50 contatos)
npm run batch -- batch_lucas/batch-output.json --pilot

# 3) Em outra janela, deixar o atendente de primeiro contato ligado
ENABLE_FIRST_CONTACT_AGENT=true OPENAI_API_KEY=SEU_TOKEN npm run listen
```

Generate quick metrics:

```bash
node src/scripts/report-first-contact.js
```

## Batch send (plataforma de disparo)

Send messages to multiple contacts with **random delays** between each message (to look more natural). Delays are between `BATCH_DELAY_MIN_MS` and `BATCH_DELAY_MAX_MS` (default 5–30 seconds).

1. Create a JSON file with an array of `{ "contact": "5511999999999", "message": "Your text" }`.
2. Run:

```bash
npm run batch -- batch-example.json
```

Contact can be phone only (e.g. `5511999999999`) or full id (`5511999999999@c.us`).

Optional safety modes:

```bash
# Small controlled pilot (max 50 processed contacts)
npm run batch -- batch-example.json --pilot

# Force list-only behavior (ignore historical skip rule)
npm run batch -- batch-example.json --force
```

Every run writes a health report to `reports/batch-health-*.json` with fail rate, block-like errors, skip reasons, and scale recommendation.

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
Each JSON entry also includes:

- `fullName`: nome completo do lead (para relatórios).
- `city`: sempre `"Joinville"` para esses leads.
- `tags`: por exemplo `["lead_meta", "imoveis_joinville"]` para facilitar futura segmentação.
- `optIn: true`: indicando que o lead veio de formulário com consentimento (necessário para a regra de LGPD do batch sender).

Para um **piloto controlado** (50–100 contatos), use:

```bash
npm run batch -- batch_lucas/batch-output.json --pilot
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `SESSION_ID` | Session identifier. Same value = same stored auth (default: `default`). |
| `BATCH_DELAY_MIN_MS` | Min delay between batch messages in ms (default: 5000). |
| `BATCH_DELAY_MAX_MS` | Max delay between batch messages in ms (default: 30000). |
| `BATCH_REQUIRE_OPT_IN` | When `true`, only sends to items with `optIn=true` (or `consented=true` / `hasConsent=true`). |
| `BATCH_SUPPRESSION_FILE` | Optional JSON file path with contacts to suppress from campaigns. |
| `BATCH_MAX_PER_RUN` | Max processed contacts per run (0 = unlimited). |
| `BATCH_COOLDOWN_EVERY` | Add cooldown pause every N processed contacts (0 = disabled). |
| `BATCH_COOLDOWN_MIN_MS` | Min cooldown pause duration in ms. |
| `BATCH_COOLDOWN_MAX_MS` | Max cooldown pause duration in ms. |
| `BATCH_STOP_FAIL_RATE` | Auto-stop threshold for fail-rate (e.g. `0.25`). |
| `BATCH_STOP_MIN_ATTEMPTS` | Minimum attempts before fail-rate stop rule applies. |
| `BATCH_BLOCKLIKE_STOP_COUNT` | Auto-stop threshold for block-like errors (0 = disabled). |
| `ENABLE_FIRST_CONTACT_AGENT` | Enables automatic first-contact attendant in `npm run listen`. |
| `FIRST_CONTACT_CONFIDENCE_THRESHOLD` | Confidence gate for automatic reply (lower confidence escalates). |
| `FIRST_CONTACT_REPLY_DELAY_MIN_MS` | Minimum natural delay before auto reply. |
| `FIRST_CONTACT_REPLY_DELAY_MAX_MS` | Maximum natural delay before auto reply. |
| `FIRST_CONTACT_REQUIRE_HUMAN_FOR_SENSITIVE` | If `true`, sensitive intents are always escalated. |
| `FIRST_CONTACT_MEMORY_PATH` | Path for persistent contact memory store. |
| `FIRST_CONTACT_DECISIONS_LOG_PATH` | Path for structured first-contact decision logs. |
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
