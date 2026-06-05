# siggla-agent — "Siggi"

Incoming-only FAQ bot for **Sigg.la**. Attends inbound WhatsApp messages, answers from a
curated knowledge base, and hands hot leads to a human via Telegram.

- **Transport-agnostic** core — WhatsApp today (Baileys), other channels later.
- **Provider-agnostic** LLM layer — **Z.ai / GLM** by default, Anthropic as a drop-in.
- **Guardrails** — bot-identity header on every message; never quotes prices, launch dates,
  or makes promises; Spanish, *usted*, semi-formal.
- **Usage limiter** — hard daily token budget + per-contact rate limit.

See [`docs/2026-06-05-siggi-design.md`](docs/2026-06-05-siggi-design.md) for the full design.

> ⚠️ Baileys is an **unofficial** WhatsApp transport. Run it on a **non-critical number**
> first — not the main business line — until proven. Plan to migrate to the official
> WhatsApp Cloud API before it carries real traffic.

## Setup

```bash
npm install
cp .env.example .env      # then fill in ZAI_API_KEY, TELEGRAM_* etc.
```

Required env: `ZAI_API_KEY` (or `ANTHROPIC_API_KEY` if `LLM_PROVIDER=anthropic`).
Optional but recommended: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` for hot-lead alerts.

## Run

```bash
npm run dev      # tsx watch (development)
npm run build && npm start   # production
```

On first run, scan the printed QR with **WhatsApp → Linked devices**. Credentials are
persisted in `WA_AUTH_DIR` (default `./auth_state`), so restarts don't re-prompt.

## Operating

- **Take over a chat:** reply `/stop` in that WhatsApp conversation (from the linked number).
  The bot goes silent there. `/start` re-activates it.
- Conversations are also auto-handed-off (bot goes silent + Telegram alert) on hot-lead
  intent, off-script questions, low confidence, or a tripped red line.

## Test

```bash
npm test         # unit tests for the core + guardrails (no WhatsApp/network needed)
npm run typecheck
```

## Edit the bot's knowledge

The bot answers **only** from `src/kb/knowledge-base.md`. Edit that file to change what it
knows; keep it short and accurate.
