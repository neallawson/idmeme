import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_FILE = process.env.DB_FILE ?? path.join(process.cwd(), 'idmeme.sqlite');

// Ensure DB directory exists
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);

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

CREATE TABLE IF NOT EXISTS ingest_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  image_id INTEGER,
  error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  finished_at DATETIME,
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

-- Full-text search virtual table (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
  image_id UNINDEXED,
  full_text
);

`;

// Run multiple statements
schema.split(';').forEach(stmt => {
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

export function insertOrIgnoreImage(row: ImageRow): number {
  const stmt = db.prepare(`INSERT OR IGNORE INTO images (path, size, hash, created_at, updated_at, tags_json)
    VALUES (@path, @size, @hash, @created_at, @updated_at, @tags_json)`);
  const info = stmt.run(row);
  // If row existed, fetch its id
  if (info.changes === 0) {
    const existing = db.prepare('SELECT id FROM images WHERE path = ?').get(row.path) as { id: number };
    return existing.id;
  }
  return info.lastInsertRowid as number;
}

export function upsertKv(imageId: number, kv: Record<string, any>) {
  const insert = db.prepare('INSERT INTO images_kv (image_id, key, value) VALUES (?, ?, ?)');
  const tx = db.transaction((obj: Record<string, any>) => {
    db.prepare('DELETE FROM images_kv WHERE image_id = ?').run(imageId);
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        v.forEach(val => insert.run(imageId, k, String(val)));
      } else if (v !== undefined && v !== null) {
        insert.run(imageId, k, String(v));
      }
    }
  });
  tx(kv);
}

export function upsertFts(imageId: number, fullText: string) {
  db.prepare('DELETE FROM images_fts WHERE image_id = ?').run(imageId);
  db.prepare('INSERT INTO images_fts (image_id, full_text) VALUES (?, ?)').run(imageId, fullText);
}

export function searchImagesAdvanced(filters: Record<string, string>, q?: string, limit = 100): ImageRow[] {
  const filterKeys = Object.keys(filters);
  let sql = `SELECT DISTINCT i.* FROM images i`;
  const params: any[] = [];
  if (q) {
    sql += ' JOIN images_fts f ON f.image_id = i.id';
  }
  if (filterKeys.length) {
    sql += ' JOIN images_kv kv ON kv.image_id = i.id';
  }
  const wheres: string[] = [];
  if (q) {
    wheres.push('f.full_text MATCH ?');
    params.push(q);
  }
  if (filterKeys.length) {
    const sub = filterKeys
      .map(k => {
        params.push(k, filters[k]);
        return '(kv.key = ? AND kv.value = ?)';
      })
      .join(' AND ');
    wheres.push(sub);
  }
  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
  sql += ' ORDER BY i.created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params) as ImageRow[];
}

export function getImageByHashSize(hash: string, size: number): ImageRow | undefined {
  return db.prepare('SELECT * FROM images WHERE hash = ? AND size = ?').get(hash, size);
}

export function searchImages(term: string): ImageRow[] {
  const like = `%${term}%`;
  return db.prepare('SELECT * FROM images WHERE tags LIKE ? OR path LIKE ?').all(like, like);
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
};

export function enqueuePaths(paths: string[]) {
  const stmt = db.prepare('INSERT INTO ingest_queue (path) VALUES (?)');
  const insertMany = db.transaction((arr: string[]) => {
    for (const p of arr) stmt.run(p);
  });
  insertMany(paths);
}

export function getNextPendingJob(): IngestJob | undefined {
  const tx = db.transaction(() => {
    const job = db
      .prepare("SELECT * FROM ingest_queue WHERE status = 'pending' ORDER BY id LIMIT 1")
      .get() as IngestJob | undefined;
    if (job) {
      db.prepare("UPDATE ingest_queue SET status = 'hashing', started_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
    }
    return job;
  });
  return tx();
}

export function updateJobStatus(id: number, status: string, error?: string, imageId?: number) {
  db.prepare(
    `UPDATE ingest_queue SET status = ?, error = ?, image_id = ?, finished_at = CASE WHEN ? IN ('done','failed') THEN CURRENT_TIMESTAMP ELSE finished_at END WHERE id = ?`
  ).run(status, error ?? null, imageId ?? null, status, id);
}
