import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

// SQLite serializes acquisition, including recovery after a killed process.
export function acquireRunLock(databasePath: string): () => void {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  const token = randomUUID();
  try {
    db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS run_lock (id INTEGER PRIMARY KEY CHECK(id = 1), pid INTEGER NOT NULL, token TEXT NOT NULL);
      BEGIN IMMEDIATE;`);
    const owner = db.prepare("SELECT pid FROM run_lock WHERE id = 1").get();
    if (owner) {
      try {
        process.kill(Number(owner.pid), 0);
        throw new Error(`已有采集进程正在使用此数据库 (PID ${owner.pid})`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    db.prepare(
      "INSERT INTO run_lock(id, pid, token) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, token = excluded.token",
    ).run(process.pid, token);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  return () => {
    try {
      db.prepare("DELETE FROM run_lock WHERE id = 1 AND token = ?").run(token);
    } finally {
      db.close();
    }
  };
}
