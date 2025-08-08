import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { enqueuePaths, searchImagesAdvanced } from './db';
import { startWorker } from './ingestWorker';
import dotenv from 'dotenv';

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
    response.body?.pipe(res);
  } catch (err) {
    console.error('Ollama proxy error', err);
    res.status(500).json({ error: 'Ollama proxy failed' });
  }
});

// Ingest API
function collectImagePaths(entries: string[]): string[] {
  const result: string[] = [];
  for (const p of entries) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      const children = fs.readdirSync(p).map(c => path.join(p, c));
      result.push(...collectImagePaths(children));
    } else if (stat.isFile()) {
      const ext = path.extname(p).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(ext)) {
        result.push(p);
      }
    }
  }
  return result;
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

  let paths: string[] = [];
  if (Array.isArray(filenames) && filenames.length) {
    // build full paths from dir + filenames
    for (const name of filenames) {
      const full = path.join(dir, name);
      if (!fs.existsSync(full)) {
        return res.status(400).json({ error: `File not found: ${full}` });
      }
      paths.push(full);
    }
  } else {
    // no filenames passed -> treat dir itself
    if (recursive) {
      paths = collectImagePaths([dir]);
    } else {
      const children = fs.readdirSync(dir).map(c => path.join(dir, c));
      paths = children.filter(p => fs.statSync(p).isFile());
    }
  }

  enqueuePaths(paths);
  res.json({ queued: paths.length });
});

app.get('/api/ingest', (_req, res) => {
  // simple listing for now
  const rows = (global as any).db?.prepare?.('SELECT * FROM ingest_queue ORDER BY id DESC LIMIT 100').all() ?? [];
  res.json(rows);
});

import { getPrompt, setPrompt, DEFAULT_PROMPT, getMaxConcurrency, setMaxConcurrency } from './settings';

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

// Settings API (currently only concurrency)
app.get('/api/settings', (_req, res) => {
  res.json({ maxConcurrency: getMaxConcurrency() });
});

app.put('/api/settings', (req, res) => {
  const { maxConcurrency } = req.body as { maxConcurrency?: number };
  if (maxConcurrency && Number.isFinite(maxConcurrency) && maxConcurrency >= 1) {
    setMaxConcurrency(Number(maxConcurrency));
  }
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
  try {
    const rows = searchImagesAdvanced(filters, q, limit ? Number(limit) : 100);
    res.json(rows);
  } catch (err) {
    console.error('search error', err);
    res.status(500).json({ error: 'search failed' });
  }
});

app.get('/api/ingest/:id', (req, res) => {
  const row = (global as any).db?.prepare?.('SELECT * FROM ingest_queue WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// start background worker
startWorker();

app.listen(PORT, () => {
  console.log(`idmeme backend listening on http://localhost:${PORT}`);
});
