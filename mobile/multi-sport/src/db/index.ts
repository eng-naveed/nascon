import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('nascon.db');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS queue (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          action_id TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          queued_at TEXT NOT NULL,
          base_version INTEGER NOT NULL,
          payload TEXT NOT NULL,
          summary TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS results (
          action_id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL,
          summary TEXT NOT NULL,
          status TEXT NOT NULL,
          resolution TEXT,
          error_code TEXT,
          at TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function cacheGet<T>(key: string): Promise<{ data: T; updatedAt: string } | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string; updated_at: string }>(
      'SELECT value, updated_at FROM cache WHERE key = ?',
      [key],
    );
    if (!row) return null;
    return { data: JSON.parse(row.value) as T, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, data: unknown): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync('INSERT OR REPLACE INTO cache (key, value, updated_at) VALUES (?, ?, ?)', [
      key,
      JSON.stringify(data),
      new Date().toISOString(),
    ]);
  } catch {}
}

export async function cacheClear(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM cache');
}

export async function kvGet(key: string): Promise<string | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value]);
}

export async function kvDel(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM kv WHERE key = ?', [key]);
}

export type QueuedAction = {
  action_id: string;
  type: 'score_event' | 'roster_transfer';
  queued_at: string;
  base_version: number;
  payload: Record<string, unknown>;
};
export type QueueRow = QueuedAction & { seq: number; summary: string };

export async function queueAdd(a: QueuedAction, summary: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO queue (action_id, type, queued_at, base_version, payload, summary) VALUES (?,?,?,?,?,?)',
    [a.action_id, a.type, a.queued_at, a.base_version, JSON.stringify(a.payload), summary],
  );
}

export async function queueList(): Promise<QueueRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    seq: number;
    action_id: string;
    type: 'score_event' | 'roster_transfer';
    queued_at: string;
    base_version: number;
    payload: string;
    summary: string;
  }>('SELECT * FROM queue ORDER BY seq ASC');
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

export async function queueRemove(ids: string[]): Promise<void> {
  const db = await getDb();
  for (const id of ids) await db.runAsync('DELETE FROM queue WHERE action_id = ?', [id]);
}

export type ResultRow = {
  action_id: string;
  type: string;
  summary: string;
  status: string;
  resolution: string | null;
  error_code: string | null;
  at: string;
};

export async function resultsSave(rows: ResultRow[]): Promise<void> {
  const db = await getDb();
  for (const r of rows) {
    await db.runAsync(
      'INSERT OR REPLACE INTO results (action_id,type,summary,status,resolution,error_code,at) VALUES (?,?,?,?,?,?,?)',
      [r.action_id, r.type, r.summary, r.status, r.resolution, r.error_code, r.at],
    );
  }
}

export async function resultsList(): Promise<ResultRow[]> {
  const db = await getDb();
  return db.getAllAsync<ResultRow>('SELECT * FROM results ORDER BY at DESC LIMIT 100');
}

export async function resultsClear(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM results');
}
