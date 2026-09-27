import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_FILE = process.env.DB_FILE ?? path.join(process.cwd(), 'idmeme.sqlite');

// Ensure DB directory exists
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

export const db = new Database(DB_FILE);

// Create schema if not exists
const schema = `
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  tags_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_images_hash_size ON images(hash, size);

CREATE TABLE IF NOT EXISTS ingest_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder TEXT NOT NULL,
  recursive INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ingest_batches_folder ON ingest_batches(folder);

CREATE TABLE IF NOT EXISTS ingest_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  image_id INTEGER,
  error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  finished_at DATETIME,
  batch_id INTEGER,
  size INTEGER,
  FOREIGN KEY(image_id) REFERENCES images(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ingest_status ON ingest_queue(status);

-- key-value table for arbitrary tags
CREATE TABLE IF NOT EXISTS images_kv (
  image_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  FOREIGN KEY(image_id) REFERENCES images(id)
);
CREATE INDEX IF NOT EXISTS idx_kv_key ON images_kv(key);
CREATE INDEX IF NOT EXISTS idx_kv_key_val ON images_kv(key,value);
CREATE INDEX IF NOT EXISTS idx_kv_key_nocase ON images_kv(key COLLATE NOCASE);

-- Full-text search virtual table (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
  image_id UNINDEXED,
  full_text
);

`;

// Run multiple statements
schema.split(';').forEach((stmt) => {
  if (stmt.trim()) db.prepare(stmt).run();
});

export type ImageRow = {
  id?: number;
  path: string;
  size: number;
  hash: string;
  created_at: string;
  updated_at: string;
  tags_json?: string;
};

export function upsertImage(row: ImageRow): number {
  db.prepare(
    `INSERT INTO images (path, size, hash, created_at, updated_at, tags_json)
     VALUES (@path, @size, @hash, @created_at, @updated_at, @tags_json)
     ON CONFLICT(path) DO UPDATE SET
       size = excluded.size,
       hash = excluded.hash,
       updated_at = excluded.updated_at,
       tags_json = excluded.tags_json`,
  ).run(row);
  const existing = db.prepare('SELECT id FROM images WHERE path = ?').get(row.path) as {
    id: number;
  };
  return existing.id;
}

export function upsertKv(imageId: number, kv: Record<string, any>) {
  const insert = db.prepare('INSERT INTO images_kv (image_id, key, value) VALUES (?, ?, ?)');
  const tx = db.transaction((obj: Record<string, any>) => {
    db.prepare('DELETE FROM images_kv WHERE image_id = ?').run(imageId);
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (Array.isArray(v)) {
        v.forEach((val) => insert.run(imageId, key, String(val)));
      } else if (v !== undefined && v !== null) {
        insert.run(imageId, key, String(v));
      }
    }
  });
  tx(kv);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function fieldPhrases(raw: string): string[] {
  return raw
    .split(',')
    .map((part) =>
      part
        .toLowerCase()
        .replace(/[.,!?;:"'`()[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

function paddedValueSql(): string {
  const punctuation = [',', '.', '!', '?', ';', ':', '"', "'"];
  let expr = 'LOWER(kv.value)';
  for (const ch of punctuation) {
    const literal = ch.replace(/'/g, "''");
    expr = `REPLACE(${expr}, '${literal}', ' ')`;
  }
  return `(' ' || ${expr} || ' ')`;
}

export function upsertFts(imageId: number, fullText: string) {
  db.prepare('DELETE FROM images_fts WHERE image_id = ?').run(imageId);
  db.prepare('INSERT INTO images_fts (image_id, full_text) VALUES (?, ?)').run(imageId, fullText);
}

export function searchImagesAdvanced(
  filters: Record<string, string>,
  q?: string,
  limit = 100,
): ImageRow[] {
  const filterKeys = Object.keys(filters);
  let sql = `SELECT DISTINCT i.* FROM images i`;
  const params: any[] = [];
  if (q) {
    sql += ' JOIN images_fts f ON f.image_id = i.id';
  }
  const wheres: string[] = [];
  if (q) {
    wheres.push('f.full_text MATCH ?');
    params.push(q);
  }
  if (filterKeys.length) {
    for (const k of filterKeys) {
      const phrases = fieldPhrases(filters[k] ?? '');
      for (const phrase of phrases) {
        wheres.push(
          `EXISTS (SELECT 1 FROM images_kv kv WHERE kv.image_id = i.id AND LOWER(kv.key) = LOWER(?) AND ${paddedValueSql()} LIKE ? ESCAPE '\\')`,
        );
        params.push(k, `% ${escapeLike(phrase)} %`);
      }
    }
  }
  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
  sql += ' ORDER BY i.created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params) as ImageRow[];
}

export function getImageByHashSize(hash: string, size: number): ImageRow | undefined {
  return db.prepare('SELECT * FROM images WHERE hash = ? AND size = ?').get(hash, size) as
    ImageRow | undefined;
}

export function searchImages(term: string): ImageRow[] {
  const like = `%${term}%`;
  return db
    .prepare('SELECT * FROM images WHERE tags_json LIKE ? OR path LIKE ?')
    .all(like, like) as ImageRow[];
}

// -------- Ingest Queue Helpers --------
export type IngestJob = {
  id?: number;
  path: string;
  status?: string;
  error?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  image_id?: number | null;
  batch_id?: number | null;
  size?: number | null;
};

export type BatchStatus = 'running' | 'paused' | 'complete';

export type IngestBatch = {
  id: number;
  folder: string;
  recursive: boolean;
  status: BatchStatus;
  created_at: string;
  updated_at: string;
  total: number;
  pending: number;
  hashing: number;
  classifying: number;
  done: number;
  failed: number;
  cancelled: number;
  bytes: number;
};

export type QueueFile = {
  id: number;
  path: string;
  status: string;
  error?: string | null;
  started_at?: string | null;
};

const BATCH_SELECT = `
SELECT
  b.id,
  b.folder,
  b.recursive,
  b.status,
  b.created_at,
  b.updated_at,
  COUNT(q.id) AS total,
  COALESCE(SUM(CASE WHEN q.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
  COALESCE(SUM(CASE WHEN q.status = 'hashing' THEN 1 ELSE 0 END), 0) AS hashing,
  COALESCE(SUM(CASE WHEN q.status = 'classifying' THEN 1 ELSE 0 END), 0) AS classifying,
  COALESCE(SUM(CASE WHEN q.status = 'done' THEN 1 ELSE 0 END), 0) AS done,
  COALESCE(SUM(CASE WHEN q.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
  COALESCE(SUM(CASE WHEN q.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
  COALESCE(SUM(q.size), 0) AS bytes
FROM ingest_batches b
LEFT JOIN ingest_queue q ON q.batch_id = b.id
`;

export function normalizeFolder(dir: string): string {
  const resolved = path.resolve(dir);
  if (resolved.length > 1 && resolved.endsWith(path.sep)) return resolved.slice(0, -1);
  return resolved;
}

function mapBatch(row: Record<string, unknown>): IngestBatch {
  return {
    id: Number(row.id),
    folder: String(row.folder),
    recursive: Boolean(row.recursive),
    status: row.status as BatchStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    total: Number(row.total),
    pending: Number(row.pending),
    hashing: Number(row.hashing),
    classifying: Number(row.classifying),
    done: Number(row.done),
    failed: Number(row.failed),
    cancelled: Number(row.cancelled),
    bytes: Number(row.bytes),
  };
}

export function listBatches(): IngestBatch[] {
  const rows = db.prepare(`${BATCH_SELECT} GROUP BY b.id ORDER BY b.id DESC`).all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapBatch);
}

export function getBatch(id: number): IngestBatch | undefined {
  const row = db.prepare(`${BATCH_SELECT} WHERE b.id = ? GROUP BY b.id`).get(id) as
    Record<string, unknown> | undefined;
  return row ? mapBatch(row) : undefined;
}

export function findLatestBatchByFolder(folder: string): IngestBatch | undefined {
  const row = db
    .prepare(`${BATCH_SELECT} WHERE b.folder = ? GROUP BY b.id ORDER BY b.id DESC LIMIT 1`)
    .get(normalizeFolder(folder)) as Record<string, unknown> | undefined;
  return row ? mapBatch(row) : undefined;
}

export function currentJobs(batchId: number): QueueFile[] {
  return db
    .prepare(
      `SELECT id, path, status, started_at FROM ingest_queue
       WHERE batch_id = ? AND status IN ('hashing', 'classifying')
       ORDER BY started_at ASC LIMIT 4`,
    )
    .all(batchId) as QueueFile[];
}

export function recentFailures(batchId: number): QueueFile[] {
  return db
    .prepare(
      `SELECT id, path, error FROM ingest_queue
       WHERE batch_id = ? AND status = 'failed'
       ORDER BY finished_at DESC LIMIT 8`,
    )
    .all(batchId) as QueueFile[];
}

function pauseOtherRunning(exceptId: number) {
  db.prepare(
    `UPDATE ingest_batches
     SET status = 'paused', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'running' AND id != ?`,
  ).run(exceptId);
}

export function refreshBatchStatus(batchId: number) {
  db.prepare(
    `UPDATE ingest_batches
     SET status = 'complete', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status IN ('running', 'paused')
       AND NOT EXISTS (
         SELECT 1 FROM ingest_queue
         WHERE batch_id = ? AND status IN ('pending', 'hashing', 'classifying')
       )`,
  ).run(batchId, batchId);
}

function fileSize(filePath: string): number | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function insertJobs(batchId: number, paths: string[]): number {
  const existsInBatch = db.prepare('SELECT 1 FROM ingest_queue WHERE batch_id = ? AND path = ?');
  const activeElsewhere = db.prepare(
    `SELECT 1 FROM ingest_queue
     WHERE path = ? AND batch_id != ? AND status IN ('pending', 'hashing', 'classifying')
     LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO ingest_queue (path, batch_id, size, status) VALUES (?, ?, ?, 'pending')`,
  );
  let queued = 0;
  for (const filePath of paths) {
    if (existsInBatch.get(batchId, filePath)) continue;
    if (activeElsewhere.get(filePath, batchId)) continue;
    const size = fileSize(filePath);
    if (size == null) continue;
    insert.run(filePath, batchId, size);
    queued++;
  }
  return queued;
}

export function ingestFolderBatch(
  folder: string,
  recursive: boolean,
  paths: string[],
): { created: boolean; queued: number; skipped: number; batch: IngestBatch } {
  const existing = findLatestBatchByFolder(folder);
  if (existing) return { created: false, queued: 0, skipped: 0, batch: existing };
  return { created: true, ...createBatch(folder, recursive, paths) };
}

export function createBatch(
  folder: string,
  recursive: boolean,
  paths: string[],
): { batch: IngestBatch; queued: number; skipped: number } {
  const tx = db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO ingest_batches (folder, recursive, status) VALUES (?, ?, 'running')`)
      .run(normalizeFolder(folder), recursive ? 1 : 0);
    const id = Number(info.lastInsertRowid);
    pauseOtherRunning(id);
    const queued = insertJobs(id, paths);
    refreshBatchStatus(id);
    const batch = getBatch(id);
    if (!batch) throw new Error('batch was not created');
    return { batch, queued, skipped: paths.length - queued };
  });
  return tx();
}

export function addPathsToBatch(
  batchId: number,
  paths: string[],
): { queued: number; skipped: number } | undefined {
  const existing = getBatch(batchId);
  if (!existing) return undefined;
  const tx = db.transaction(() => {
    const queued = insertJobs(batchId, paths);
    if (queued > 0 && existing.status === 'complete') {
      db.prepare(
        `UPDATE ingest_batches SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(batchId);
      pauseOtherRunning(batchId);
    }
    return { queued, skipped: paths.length - queued };
  });
  return tx();
}

export function setBatchStatus(id: number, status: BatchStatus): IngestBatch | undefined {
  const tx = db.transaction(() => {
    if (status === 'running') pauseOtherRunning(id);
    const info = db
      .prepare(`UPDATE ingest_batches SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, id);
    if (info.changes === 0) return undefined;
    return getBatch(id);
  });
  return tx();
}

export function retryFailed(batchId: number): number | undefined {
  if (!getBatch(batchId)) return undefined;
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `UPDATE ingest_queue
         SET status = 'pending', error = NULL, started_at = NULL, finished_at = NULL
         WHERE batch_id = ? AND status = 'failed'`,
      )
      .run(batchId);
    if (info.changes > 0) {
      db.prepare(
        `UPDATE ingest_batches SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(batchId);
      pauseOtherRunning(batchId);
    }
    return info.changes;
  });
  return tx();
}

export function cancelPending(batchId: number): number | undefined {
  if (!getBatch(batchId)) return undefined;
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `UPDATE ingest_queue
         SET status = 'cancelled', error = NULL, finished_at = CURRENT_TIMESTAMP
         WHERE batch_id = ? AND status = 'pending'`,
      )
      .run(batchId);
    refreshBatchStatus(batchId);
    return info.changes;
  });
  return tx();
}

export function recoverStuckJobs(): number {
  const info = db
    .prepare(
      `UPDATE ingest_queue
       SET status = 'pending', started_at = NULL, error = NULL
       WHERE status IN ('hashing', 'classifying')`,
    )
    .run();
  return info.changes;
}

export function getNextPendingJob(): IngestJob | undefined {
  const tx = db.transaction(() => {
    const job = db
      .prepare(
        `SELECT q.* FROM ingest_queue q
         JOIN ingest_batches b ON b.id = q.batch_id
         WHERE q.status = 'pending' AND b.status = 'running'
         ORDER BY b.created_at ASC, q.id ASC
         LIMIT 1`,
      )
      .get() as IngestJob | undefined;
    if (job?.id != null) {
      db.prepare(
        "UPDATE ingest_queue SET status = 'hashing', started_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(job.id);
    }
    return job;
  });
  return tx();
}

export function updateJobStatus(id: number, status: string, error?: string, imageId?: number) {
  db.prepare(
    `UPDATE ingest_queue
     SET status = ?, error = ?, image_id = ?,
         finished_at = CASE WHEN ? IN ('done', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE finished_at END
     WHERE id = ?`,
  ).run(status, error ?? null, imageId ?? null, status, id);
  if (status === 'done' || status === 'failed' || status === 'cancelled') {
    const row = db.prepare('SELECT batch_id FROM ingest_queue WHERE id = ?').get(id) as
      { batch_id: number | null } | undefined;
    if (row?.batch_id != null) refreshBatchStatus(row.batch_id);
  }
}

const JOB_RANK: Record<string, number> = {
  classifying: 5,
  hashing: 4,
  pending: 3,
  done: 2,
  failed: 1,
  cancelled: 0,
};

function migrateIngestBatches() {
  const cols = db.prepare('PRAGMA table_info(ingest_queue)').all() as { name: string }[];
  const names = new Set(cols.map((col) => col.name));
  if (!names.has('batch_id')) db.exec('ALTER TABLE ingest_queue ADD COLUMN batch_id INTEGER');
  if (!names.has('size')) db.exec('ALTER TABLE ingest_queue ADD COLUMN size INTEGER');

  const orphans = db
    .prepare('SELECT id, path, status FROM ingest_queue WHERE batch_id IS NULL')
    .all() as { id: number; path: string; status: string }[];

  const assignOrphans = db.transaction(() => {
    const byFolder = new Map<string, { id: number; path: string; status: string }[]>();
    for (const row of orphans) {
      const folder = path.dirname(row.path);
      const list = byFolder.get(folder) ?? [];
      list.push(row);
      byFolder.set(folder, list);
    }
    const insertBatch = db.prepare(
      `INSERT INTO ingest_batches (folder, recursive, status) VALUES (?, 1, ?)`,
    );
    const assign = db.prepare('UPDATE ingest_queue SET batch_id = ?, size = ? WHERE id = ?');
    const remove = db.prepare('DELETE FROM ingest_queue WHERE id = ?');
    for (const [folder, rows] of byFolder) {
      const best = new Map<string, { id: number; path: string; status: string }>();
      const drop: number[] = [];
      for (const row of rows) {
        const prev = best.get(row.path);
        if (!prev) {
          best.set(row.path, row);
          continue;
        }
        const prevRank = JOB_RANK[prev.status] ?? 0;
        const rank = JOB_RANK[row.status] ?? 0;
        const takeNew = rank > prevRank || (rank === prevRank && row.id > prev.id);
        if (takeNew) {
          drop.push(prev.id);
          best.set(row.path, row);
        } else {
          drop.push(row.id);
        }
      }
      for (const id of drop) remove.run(id);
      const kept = [...best.values()];
      const active = kept.some(
        (row) =>
          row.status === 'pending' || row.status === 'hashing' || row.status === 'classifying',
      );
      const batchId = Number(
        insertBatch.run(folder, active ? 'running' : 'complete').lastInsertRowid,
      );
      for (const row of kept) assign.run(batchId, fileSize(row.path), row.id);
    }
  });
  if (orphans.length) assignOrphans();

  db.exec('CREATE INDEX IF NOT EXISTS idx_ingest_batch_status ON ingest_queue(batch_id, status)');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_batch_path ON ingest_queue(batch_id, path)',
  );

  const running = db
    .prepare(`SELECT id FROM ingest_batches WHERE status = 'running' ORDER BY id ASC`)
    .all() as {
    id: number;
  }[];
  if (running.length > 1) {
    const active = db
      .prepare(
        `SELECT b.id FROM ingest_batches b
         JOIN ingest_queue q ON q.batch_id = b.id
         WHERE b.status = 'running' AND q.status IN ('hashing', 'classifying')
         ORDER BY b.id ASC LIMIT 1`,
      )
      .get() as { id: number } | undefined;
    pauseOtherRunning(active?.id ?? running[0].id);
  }
}

migrateIngestBatches();
