# Siggi — Sigg.la incoming-message bot (v1 design)

**Date:** 2026-06-05
**Status:** Approved (brainstorming) → implementing v1
**Repo:** `github.com/alexvergara/siggla-agent`

## Purpose

A bot ("Siggi") that **attends incoming messages** for Sigg.la — first on WhatsApp,
later other channels. v1 is a **prospect FAQ bot**: it answers questions about what
Sigg.la is, the systems/connectors, and the Demo, and hands hot leads to a human.

**Incoming-only** by design: the bot never initiates conversations. Replying inside a
user-initiated thread is what keeps an unofficial WhatsApp transport off the ban radar.

## Scope

### v1 (this build)
- WhatsApp transport (Baileys), incoming messages only.
- Custom agent loop over a **provider-agnostic LLM layer** (default: **Z.ai / GLM**).
- Curated, static **knowledge base** loaded into the system prompt (no vector DB).
- **Human handoff**: auto-escalate on hot-lead / off-script / low-confidence + manual mute.
- **Telegram** hot-lead notifications (name, number, last messages, reason).
- **Usage limiter**: hard token budget per day + per-contact rate limit.
- Guardrails: bot-identity header on every message; never quote prices / launch dates /
  promises; Spanish, *usted*, semi-formal.

### Explicitly out of scope (later)
- **v2:** authenticated "site helper" for current clients with **read-only PESV DB**
  access (per-account authorization driven by phone → account mapping).
- Outbound / proactive messaging (template approvals, official API needed).
- Official WhatsApp Cloud API transport (planned migration once it carries real traffic).
- A dedicated demo landing page (marketing task, separate).

## Architecture

```
Channel adapters            Core (transport- & provider-agnostic)        External
─────────────────           ──────────────────────────────────          ──────────
WhatsApp (Baileys)  ──┐
(future: Telegram in, ─┼─▶ Agent ─▶ Guardrails ─▶ LLMProvider ──▶ Z.ai (GLM) / Anthropic
 Cloud API)           │     │  │         │
                      │     │  │         └─ usage limiter (token budget, rate limit)
                      │     │  └─ KB (markdown → system prompt)
                      │     └─ Session store (SQLite: history + status + usage)
                      │
                      └─▶ Telegram notifier (hot-lead alerts to owner)
```

**Two axes of swappability:**
- *Transport* — the WhatsApp adapter only normalizes inbound → `InboundMessage` and sends
  text back. The agent never references WhatsApp. New channel = new adapter.
- *Model* — `LLMProvider` interface; `zai` (OpenAI-compatible) is default, `anthropic` is a
  drop-in. Switch by `LLM_PROVIDER` env. The Max-plan subscription path was rejected
  (consumer ToS forbids automated/headless services); Z.ai API key carries no such risk.

## Message-handling flow (per inbound)

1. Baileys → normalize to `{channel, contactId, name, text, timestamp}`.
2. If message is **from the owner** (linked number): check control keywords
   (`/stop` mutes this chat, `/start` re-activates). Not a control word → ignore.
3. Look up contact status: `muted` or `handed_off` → **stay silent**.
4. Rate-limit + token-budget check → if exceeded, send safe canned reply + Telegram alert.
5. Build prompt: KB system prompt + guardrails + last N turns + new message.
6. LLM returns JSON `{reply, escalate, reason}`.
7. `escalate` → send holding reply, mark `handed_off`, fire Telegram alert. Else send reply.
8. Header is prepended **in code** (model can't forget it). Persist the turn + usage.

## Guardrails

- **Header on every outbound:** `🤖 Siggi · asistente virtual de Sigg.la`.
- **Never:** quote prices, give launch dates, promise anything (incl. SISI/SINST readiness).
- Only Sigg.la / PESV-domain topics; off-domain → escalate, don't improvise.
- Spanish, *usted*, semi-formal (mirrors the company email-tone rule).
- Uncertain → escalate. "No sé, lo confirma un asesor" is a valid, safe outcome.
- Best-effort **output check**: if a reply leaks a price/date pattern, override to escalate.

## Anti-ban hygiene (Baileys)

- Reply only to inbound; never initiate.
- Human-like typing delay before sending; per-contact rate limit.
- Run on a **non-critical number first** — not the main +57 317 6488900 — until proven.
- Persisted multi-file auth state so restarts don't require re-scanning the QR.

## Storage (SQLite — `node:sqlite`)

- `contacts(contact_id PK, name, history JSON, status, last_seen)`
- `usage(period PK 'YYYY-MM-DD', input_tokens, output_tokens)`

Single-node on OVH. If it goes multi-host later, this is the one piece that moves to
Postgres/Redis — isolated by design.

## Project layout

```
src/
  config.ts            # env → typed config
  core/
    types.ts           # InboundMessage, AgentReply, LLM types
    llm.ts             # LLMProvider interface + Z.ai + Anthropic
    session.ts         # SQLite: history, status, usage
    guardrails.ts      # header, red-line checks, system prompt
    agent.ts           # the orchestrating loop (no transport/notifier imports)
  adapters/
    whatsapp.ts        # Baileys ⇄ normalized message + owner control keywords
    telegram.ts        # hot-lead notifier (plain Bot API fetch)
  kb/knowledge-base.md # curated facts (owned/edited by the team)
  index.ts             # wires everything together
test/                  # core + guardrail unit tests (no WhatsApp needed)
```

## Testing

- Unit-test the agent with canned messages: answers from KB, escalates on
  price/date/off-script, always includes header, never invents prices/dates.
- Each red line is an explicit test case.
- Manual smoke test on the burner number for the WhatsApp happy path + one escalation.

## Hosting

OVH (single long-lived Node process; pm2 or systemd/Docker) holding the Baileys WS session
+ persisted creds. Multi-host/balanced later when client volume grows.
