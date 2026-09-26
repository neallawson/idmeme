import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import {
  searchImagesAdvanced,
  db,
  normalizeFolder,
  ingestFolderBatch,
  listBatches,
  getBatch,
  currentJobs,
  recentFailures,
  setBatchStatus,
  retryFailed,
  cancelPending,
  addPathsToBatch,
} from './db';
import { startWorker } from './ingestWorker';
import {
  getPrompt,
  setPrompt,
  DEFAULT_PROMPT,
  getMaxConcurrency,
  setMaxConcurrency,
  getModel,
  setModel,
  getTemperature,
  setTemperature,
} from './settings';
import dotenv from 'dotenv';
import { Readable } from 'stream';

dotenv.config();

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/ping', (_req, res) => {
  res.json({ status: 'ok', ollama: OLLAMA_BASE_URL });
});

// OpenAI-compatible chat completions proxy to Ollama
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    // Stream Ollama response back to client unchanged (supports SSE/streaming)
    res.status(response.status);
    if (response.body) {
      try {
        // Node 18+ ReadableStream -> Node stream
        Readable.fromWeb(response.body as any).pipe(res);
      } catch {
        // Fallback: buffer and send
        const buf = Buffer.from(await response.arrayBuffer());
        res.send(buf);
      }
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Ollama proxy error', err);
    res.status(500).json({ error: 'Ollama proxy failed' });
  }
});

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff']);

function isImagePath(p: string): boolean {
  return IMAGE_EXTS.has(path.extname(p).toLowerCase());
}

// Ingest API
function collectImagePaths(entries: string[]): string[] {
  const result: string[] = [];
  for (const p of entries) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      let children: string[] = [];
      try {
        children = fs.readdirSync(p).map((c) => path.join(p, c));
      } catch {
        continue;
      }
      result.push(...collectImagePaths(children));
    } else if (stat.isFile() && isImagePath(p)) {
      result.push(p);
    }
  }
  return result;
}

function imagesInDirectory(dir: string, recursive: boolean): string[] {
  if (recursive) return collectImagePaths([dir]);
  let children: string[] = [];
  try {
    children = fs.readdirSync(dir).map((child) => path.join(dir, child));
  } catch {
    return [];
  }
  return children.filter((child) => {
    try {
      return fs.statSync(child).isFile() && isImagePath(child);
    } catch {
      return false;
    }
  });
}

function namedImages(dir: string, filenames: string[]): { paths: string[] } | { error: string } {
  const paths: string[] = [];
  for (const name of filenames) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) return { error: `File not found: ${full}` };
    if (!isImagePath(full)) return { error: `Unsupported file: ${full}` };
    paths.push(full);
  }
  return { paths };
}

app.post('/api/ingest', (req, res) => {
  const { dir, filenames, recursive } = req.body as {
    dir: string;
    filenames?: string[];
    recursive?: boolean;
  };

  if (!dir || typeof dir !== 'string') {
    return res.status(400).json({ error: 'dir string required' });
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return res.status(400).json({ error: `Directory not found: ${dir}` });
  }

  const folder = normalizeFolder(dir);
  let paths: string[] = [];
  if (Array.isArray(filenames) && filenames.length) {
    const named = namedImages(dir, filenames);
    if ('error' in named) return res.status(400).json({ error: named.error });
    paths = named.paths;
  } else {
    paths = imagesInDirectory(dir, Boolean(recursive));
  }

  res.json(ingestFolderBatch(folder, Boolean(recursive), paths));
});

app.get('/api/batches', (_req, res) => {
  res.json(listBatches());
});

app.get('/api/batches/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid batch id' });
  const batch = getBatch(id);
  if (!batch) return res.status(404).json({ error: 'batch not found' });
  res.json({ ...batch, current: currentJobs(id), failures: recentFailures(id) });
});

app.post('/api/batches/:id/pause', (req, res) => {
  const id = Number(req.params.id);
  const batch = getBatch(id);
  if (!batch) return res.status(404).json({ error: 'batch not found' });
  if (batch.status !== 'running') return res.json({ batch });
  const updated = setBatchStatus(id, 'paused');
  res.json({ batch: updated });
});

app.post('/api/batches/:id/resume', (req, res) => {
  const id = Number(req.params.id);
  const batch = getBatch(id);
  if (!batch) return res.status(404).json({ error: 'batch not found' });
  const active = batch.pending + batch.hashing + batch.classifying;
  if (batch.status === 'running' || active === 0) return res.json({ batch });
  const updated = setBatchStatus(id, 'running');
  res.json({ batch: updated });
});

app.post('/api/batches/:id/retry', (req, res) => {
  const id = Number(req.params.id);
  const retried = retryFailed(id);
  if (retried == null) return res.status(404).json({ error: 'batch not found' });
  res.json({ retried, batch: getBatch(id) });
});

app.post('/api/batches/:id/cancel-pending', (req, res) => {
  const id = Number(req.params.id);
  const cancelled = cancelPending(id);
  if (cancelled == null) return res.status(404).json({ error: 'batch not found' });
  res.json({ cancelled, batch: getBatch(id) });
});

app.post('/api/batches/:id/rescan', (req, res) => {
  const id = Number(req.params.id);
  const batch = getBatch(id);
  if (!batch) return res.status(404).json({ error: 'batch not found' });
  if (!fs.existsSync(batch.folder) || !fs.statSync(batch.folder).isDirectory()) {
    return res.status(400).json({ error: `Directory not found: ${batch.folder}` });
  }
  const paths = imagesInDirectory(batch.folder, batch.recursive);
  const added = addPathsToBatch(id, paths);
  if (!added) return res.status(404).json({ error: 'batch not found' });
  res.json({ ...added, batch: getBatch(id) });
});

// Serve local image files safely
app.get('/api/file', (req, res) => {
  const p = (req.query.path as string) ?? '';
  if (!p) return res.status(400).json({ error: 'path required' });
  // Basic protection: only allow absolute paths and image extensions
  const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
  const ext = path.extname(p).toLowerCase();
  if (!allowedExt.includes(ext)) return res.status(400).json({ error: 'unsupported file' });
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    return res.status(404).json({ error: 'not found' });
  }
  res.sendFile(path.resolve(p));
});

// Prompt API
app.get('/api/prompt', (_req, res) => {
  const current = getPrompt();
  res.json({ prompt: current, isDefault: current === DEFAULT_PROMPT });
});

app.put('/api/prompt', (req, res) => {
  const { prompt } = req.body as { prompt?: string };
  setPrompt(prompt && prompt.trim() ? prompt : undefined);
  res.json({ ok: true });
});

// Settings API
app.get('/api/settings', (_req, res) => {
  res.json({
    maxConcurrency: getMaxConcurrency(),
    model: getModel(),
    temperature: getTemperature(),
    modelFromEnv: Boolean(process.env.OLLAMA_MODEL?.trim()),
    temperatureFromEnv: Boolean(process.env.OLLAMA_TEMPERATURE?.trim()),
  });
});

app.put('/api/settings', (req, res) => {
  const { maxConcurrency, model, temperature } = req.body as {
    maxConcurrency?: number;
    model?: string;
    temperature?: number;
  };
  if (maxConcurrency && Number.isFinite(maxConcurrency) && maxConcurrency >= 1) {
    setMaxConcurrency(Number(maxConcurrency));
  }
  if (typeof model === 'string') setModel(model);
  if (typeof temperature === 'number' && Number.isFinite(temperature)) setTemperature(temperature);
  res.json({ ok: true });
});

// Search API
app.get('/api/search', (req, res) => {
  const { q, limit } = req.query as { q?: string; limit?: string };
  const filters: Record<string, string> = {};
  Object.entries(req.query).forEach(([k, v]) => {
    if (k === 'q' || k === 'limit') return;
    if (typeof v === 'string') filters[k] = v;
  });
  const term = q?.trim() || undefined;
  try {
    const rows = searchImagesAdvanced(filters, term, limit ? Number(limit) : 100);
    res.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    const ftsError =
      message.includes('fts5') ||
      message.includes('unterminated string') ||
      message.includes('unknown special query');
    if (ftsError) {
      return res.status(400).json({ error: 'Invalid search query' });
    }
    console.error('search error', err);
    res.status(500).json({ error: 'search failed' });
  }
});

// Unique keys from images_kv (for Filtered Search UI) - case-insensitive
app.get('/api/kv/keys', (_req, res) => {
  const rows = db
    .prepare('SELECT DISTINCT LOWER(key) AS key FROM images_kv ORDER BY LOWER(key) ASC')
    .all() as { key: string }[];
  res.json(rows.map((r) => r.key));
});

app.get('/api/ingest/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM ingest_queue WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// start background worker
startWorker();

app.listen(PORT, () => {
  console.log(`idmeme backend listening on http://localhost:${PORT}`);
});
