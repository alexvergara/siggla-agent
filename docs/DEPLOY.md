# Deploying Siggi (OVH)

Two supported ways to run the bot on a server. Pick **one**. Both need a `.env`
(`cp .env.example .env` and fill in `ZAI_API_KEY`, `TELEGRAM_*`, etc.).

> ⚠️ First run links a WhatsApp device by **QR code printed to the logs**. Use a
> **non-critical/burner number** — not the main +57 317 6488900. The linked-device
> credentials persist in `auth_state/`, so later restarts don't re-prompt.

---

## Option A — Docker Compose (recommended)

```bash
git clone https://github.com/alexvergara/siggla-agent.git /opt/siggla-agent
cd /opt/siggla-agent
cp .env.example .env && nano .env          # fill in keys
docker compose up -d --build
docker compose logs -f                      # scan the QR shown here on first run
```

- State persists in the bind-mounted `./auth_state` and `./data` dirs.
- The KB is bind-mounted read-only: edit `src/kb/knowledge-base.md` then
  `docker compose restart` — no rebuild needed.
- Update: `git pull && docker compose up -d --build`.
- Stop / start: `docker compose stop` / `docker compose start`.

---

## Option B — systemd (bare Node, no Docker)

Requires Node ≥ 24 on the box (for the built-in `node:sqlite`).

```bash
git clone https://github.com/alexvergara/siggla-agent.git /opt/siggla-agent
cd /opt/siggla-agent
npm ci && npm run build
cp .env.example .env && nano .env

# Service account that owns the dir + state:
sudo useradd --system --home /opt/siggla-agent siggla || true
sudo chown -R siggla:siggla /opt/siggla-agent

# Install the unit (edit ExecStart path if `which node` differs):
sudo cp deploy/siggla-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now siggla-agent
sudo journalctl -u siggla-agent -f          # scan the QR shown here on first run
```

- Restart after KB/`.env` edits: `sudo systemctl restart siggla-agent`.
- Update: `git pull && npm ci && npm run build && sudo systemctl restart siggla-agent`.

---

## Option C — PM2 (alternative process manager)

```bash
cd /opt/siggla-agent
npm ci && npm run build
cp .env.example .env && nano .env
pm2 start ecosystem.config.cjs
pm2 logs siggla-agent                        # scan the QR on first run
pm2 save && pm2 startup                       # survive reboots
```

---

## Operating notes

- **Take over a chat:** from the linked number, reply `/stop` in that conversation
  (bot goes silent there); `/start` re-activates it.
- **Hot-lead alerts** go to Telegram if `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are set.
- **Logs** are the place to watch: first-run QR, connections, escalations, errors.
- **Backups worth keeping:** `auth_state/` (avoids re-linking) and `data/` (history/usage).
