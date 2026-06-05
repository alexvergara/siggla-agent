/**
 * SQLite-backed session store (uses Node's built-in node:sqlite — no native deps).
 *
 * Holds per-contact conversation history + status, a daily token-usage ledger,
 * and a lightweight message log for per-contact rate limiting.
 */
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { ContactStatus, Turn } from './types.js';

// Load the built-in node:sqlite at runtime via require so bundlers/test runners
// (Vite/Vitest) don't try to statically resolve this recent Node built-in.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

export interface ContactRecord {
  contactId: string;
  name: string;
  history: Turn[];
  status: ContactStatus;
  lastSeen: number | null;
}

export class SessionStore {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        contact_id TEXT PRIMARY KEY,
        name       TEXT,
        history    TEXT    NOT NULL DEFAULT '[]',
        status     TEXT    NOT NULL DEFAULT 'active',
        last_seen  INTEGER
      );
      CREATE TABLE IF NOT EXISTS usage (
        period        TEXT PRIMARY KEY,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS message_log (
        contact_id TEXT    NOT NULL,
        ts         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_log ON message_log (contact_id, ts);
    `);
  }

  getContact(contactId: string): ContactRecord | null {
    const row = this.db
      .prepare('SELECT contact_id, name, history, status, last_seen FROM contacts WHERE contact_id = ?')
      .get(contactId) as
      | { contact_id: string; name: string | null; history: string; status: string; last_seen: number | null }
      | undefined;
    if (!row) return null;
    return {
      contactId: row.contact_id,
      name: row.name ?? '',
      history: safeParseHistory(row.history),
      status: (row.status as ContactStatus) ?? 'active',
      lastSeen: row.last_seen,
    };
  }

  getStatus(contactId: string): ContactStatus {
    return this.getContact(contactId)?.status ?? 'active';
  }

  setStatus(contactId: string, status: ContactStatus, name = ''): void {
    this.db
      .prepare(
        `INSERT INTO contacts (contact_id, name, status, last_seen)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(contact_id) DO UPDATE SET status = excluded.status,
           name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE contacts.name END`,
      )
      .run(contactId, name, status, Date.now());
  }

  /** Append turns to a contact's history, trimming to the most recent `limit` turns. */
  appendTurns(contactId: string, name: string, turns: Turn[], limit: number): void {
    const existing = this.getContact(contactId);
    const history = [...(existing?.history ?? []), ...turns].slice(-limit);
    this.db
      .prepare(
        `INSERT INTO contacts (contact_id, name, history, status, last_seen)
         VALUES (?, ?, ?, COALESCE((SELECT status FROM contacts WHERE contact_id = ?), 'active'), ?)
         ON CONFLICT(contact_id) DO UPDATE SET
           history = excluded.history,
           last_seen = excluded.last_seen,
           name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE contacts.name END`,
      )
      .run(contactId, name, JSON.stringify(history), contactId, Date.now());
  }

  // ─── Usage ledger (token budget) ────────────────────────────────

  addUsage(period: string, inputTokens: number, outputTokens: number): void {
    this.db
      .prepare(
        `INSERT INTO usage (period, input_tokens, output_tokens)
         VALUES (?, ?, ?)
         ON CONFLICT(period) DO UPDATE SET
           input_tokens = usage.input_tokens + excluded.input_tokens,
           output_tokens = usage.output_tokens + excluded.output_tokens`,
      )
      .run(period, inputTokens, outputTokens);
  }

  getUsageTotal(period: string): number {
    const row = this.db
      .prepare('SELECT input_tokens, output_tokens FROM usage WHERE period = ?')
      .get(period) as { input_tokens: number; output_tokens: number } | undefined;
    if (!row) return 0;
    return row.input_tokens + row.output_tokens;
  }

  // ─── Per-contact rate limiting ──────────────────────────────────

  logMessage(contactId: string, ts: number): void {
    this.db.prepare('INSERT INTO message_log (contact_id, ts) VALUES (?, ?)').run(contactId, ts);
  }

  countMessagesSince(contactId: string, sinceTs: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM message_log WHERE contact_id = ? AND ts >= ?')
      .get(contactId, sinceTs) as { c: number };
    return row.c;
  }

  /** Housekeeping: drop message-log rows older than `beforeTs`. */
  pruneMessageLog(beforeTs: number): void {
    this.db.prepare('DELETE FROM message_log WHERE ts < ?').run(beforeTs);
  }

  close(): void {
    this.db.close();
  }
}

function safeParseHistory(raw: string): Turn[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Turn[]) : [];
  } catch {
    return [];
  }
}
