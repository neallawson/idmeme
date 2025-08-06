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
  tags TEXT
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
  tags?: string;
};

export function insertOrIgnoreImage(row: ImageRow) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO images (path, size, hash, created_at, updated_at, tags)
    VALUES (@path, @size, @hash, @created_at, @updated_at, @tags)`);
  stmt.run(row);
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
