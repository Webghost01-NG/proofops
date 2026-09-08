import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attempt, CaseInput, CaseRecord, NetworkConfig, Observation, Status } from './types.js';
import { InputError, json } from './validation.js';

export class Store {
  private db: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'cases.sqlite');
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY, input TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, networks TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id),
        started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
        observations TEXT NOT NULL DEFAULT '[]', owner_pid INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS attempts_case ON attempts(case_id, started_at);
    `);
    this.recoverInterrupted();
  }

  create(input: CaseInput, config: NetworkConfig): CaseRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const networks = { sourceChainId: config.sourceChainId, creditcoinChainId: config.creditcoinChainId, sourceChainKey: config.sourceChainKey };
    this.db.prepare('INSERT INTO cases VALUES (?, ?, ?, ?, ?)').run(id, json(input), now, now, json(networks));
    return this.get(id);
  }

  get(id: string): CaseRecord {
    const row = this.db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as Record<string, string> | undefined;
    if (!row) throw new InputError('Case not found.');
    const attempts = this.db.prepare('SELECT * FROM attempts WHERE case_id = ? ORDER BY rowid').all(id) as Record<string, string | null>[];
    return {
      id: row.id, input: JSON.parse(row.input), createdAt: row.created_at, updatedAt: row.updated_at,
      ...JSON.parse(row.networks),
      attempts: attempts.map(a => ({ id: a.id!, caseId: a.case_id!, startedAt: a.started_at!, finishedAt: a.finished_at, status: a.status as Status, observations: JSON.parse(a.observations!) }))
    };
  }

  list(): CaseRecord[] {
    return (this.db.prepare('SELECT id FROM cases ORDER BY updated_at DESC, rowid DESC LIMIT 200').all() as { id: string }[]).map(row => this.get(row.id));
  }

  start(id: string): Attempt {
    this.get(id);
    const attempt: Attempt = { id: randomUUID(), caseId: id, startedAt: new Date().toISOString(), finishedAt: null, status: 'running', observations: [] };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const active = this.db.prepare("SELECT id FROM attempts WHERE case_id = ? AND status = 'running'").get(id);
      if (active) throw new InputError('This case already has a running attempt.');
      this.db.prepare('INSERT INTO attempts (id, case_id, started_at, status, owner_pid) VALUES (?, ?, ?, ?, ?)').run(attempt.id, id, attempt.startedAt, 'running', process.pid);
      this.db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(attempt.startedAt, id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return attempt;
  }

  observe(attempt: Attempt, observation: Observation): void {
    attempt.observations.push(observation);
    this.db.prepare("UPDATE attempts SET observations = ? WHERE id = ? AND status = 'running'").run(json(attempt.observations), attempt.id);
  }

  finish(attempt: Attempt, status: Status): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE attempts SET status = ?, finished_at = ? WHERE id = ?').run(status, now, attempt.id);
    this.db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, attempt.caseId);
    attempt.status = status;
    attempt.finishedAt = now;
  }

  private recoverInterrupted(): void {
    const active = this.db.prepare("SELECT id, owner_pid FROM attempts WHERE status = 'running'").all() as { id: string; owner_pid: number }[];
    for (const row of active) {
      try { process.kill(row.owner_pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          this.db.prepare("UPDATE attempts SET status = 'interrupted', finished_at = ? WHERE id = ? AND status = 'running'").run(new Date().toISOString(), row.id);
        }
      }
    }
  }

  interruptOwn(): void {
    this.db.prepare("UPDATE attempts SET status = 'interrupted', finished_at = ? WHERE status = 'running' AND owner_pid = ?").run(new Date().toISOString(), process.pid);
  }

  close(): void { this.db.close(); }
}
