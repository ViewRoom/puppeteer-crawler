import type { DatabaseSync } from "node:sqlite";

export function migrate(db: DatabaseSync): void {
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
  if (version > 2)
    throw new Error(
      `数据库版本 ${version} 高于当前程序支持的版本 2，请升级程序`,
    );
  db.exec("PRAGMA journal_mode = WAL");
  if (version === 2) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY, site TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
        updated_at TEXT NOT NULL, UNIQUE(site, url)
      );
      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id), url TEXT NOT NULL,
        title TEXT NOT NULL, position INTEGER NOT NULL, content TEXT, fetched_at TEXT,
        active INTEGER NOT NULL DEFAULT 1, UNIQUE(book_id, url)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id), site_config TEXT NOT NULL,
        status TEXT NOT NULL, catalog_complete INTEGER NOT NULL DEFAULT 0, refresh INTEGER NOT NULL DEFAULT 0,
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_items (
        task_id TEXT NOT NULL REFERENCES tasks(id), chapter_id TEXT NOT NULL REFERENCES chapters(id),
        position INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY(task_id, chapter_id)
      );
      CREATE INDEX IF NOT EXISTS task_items_status ON task_items(task_id, status);
      CREATE INDEX IF NOT EXISTS chapters_book ON chapters(book_id, active, position);
      CREATE TABLE IF NOT EXISTS sites (
        name TEXT PRIMARY KEY, config TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO sites(name, config, updated_at)
        SELECT json_extract(site_config, '$.name'), site_config, updated_at FROM tasks
        WHERE json_valid(site_config) AND json_extract(site_config, '$.name') IS NOT NULL
        ORDER BY updated_at DESC, rowid DESC;
      CREATE TABLE IF NOT EXISTS task_queue (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id), mode TEXT NOT NULL,
        queued_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_controls (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id), action TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT REFERENCES tasks(id),
        level TEXT NOT NULL, message TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_events_task ON task_events(task_id, id);
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY, site TEXT NOT NULL REFERENCES sites(name), url TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        next_run_at INTEGER NOT NULL, last_run_at INTEGER, last_task_id TEXT REFERENCES tasks(id), error TEXT
      );
      CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id), format TEXT NOT NULL,
        status TEXT NOT NULL, missing INTEGER NOT NULL DEFAULT 0, filename TEXT NOT NULL,
        error TEXT, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS task_book_active ON tasks(book_id)
        WHERE status IN ('pending', 'queued', 'running', 'paused', 'interrupted', 'failed');
      PRAGMA user_version = 2;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
