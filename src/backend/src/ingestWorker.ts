import fs from 'fs';
import path from 'path';
import { getNextPendingJob, updateJobStatus, insertOrIgnoreImage } from './db';
import { hashFile } from './hashing';
import { classifyImage } from './ollama';

// Process jobs at a fast tick but limit concurrent runs via settings
const TICK_MS = 500; // polling interval
import { getMaxConcurrency } from './settings';
let inFlight = 0;

async function processJob() {
  if (inFlight >= getMaxConcurrency()) return;
  const job = getNextPendingJob();
  if (!job) return; // nothing pending

  try {
    // Verify file exists
    if (!fs.existsSync(job.path)) {
      updateJobStatus(job.id!, 'failed', 'File not found');
      return;
    }

    // Compute metadata
    const stat = fs.statSync(job.path);
    const hash = await hashFile(job.path);

    // Deduplicate check is done by INSERT OR IGNORE
    inFlight++;
    // Mark stage: classifying (after hashing)
    updateJobStatus(job.id!, 'classifying');
    const tagsStr = await classifyImage(job.path);
    const tagsJson = tagsStr?.trim() || '{}';
    if (tagsJson === '{}' || tagsJson === '') {
      updateJobStatus(job.id!, 'failed', 'empty AI result');
      return;
    }

    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(tagsJson);
    } catch {
      // fallback: treat entire string as keyword field
      parsed = { keywords: [tagsStr] };
    }

    const imageId = insertOrIgnoreImage({
      path: job.path,
      size: stat.size,
      hash,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags_json: tagsJson
    });

    // kv and fts
    const { upsertKv, upsertFts } = await import('./db');
    upsertKv(imageId, parsed);
    const fullText = Object.values(parsed)
      .flat()
      .join(' ');
    upsertFts(imageId, fullText);

    updateJobStatus(job.id!, 'done', undefined, imageId);
  } catch (err: any) {
    console.error('Ingest job failed', err);
    updateJobStatus(job.id!, 'failed', err.message);
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
}

export function startWorker() {
  setInterval(processJob, TICK_MS);
}
