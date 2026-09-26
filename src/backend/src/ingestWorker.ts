import fs from 'fs';
import {
  getNextPendingJob,
  updateJobStatus,
  upsertImage,
  upsertKv,
  upsertFts,
  recoverStuckJobs,
  getImageByHashSize,
} from './db';
import { hashFile } from './hashing';
import { classifyImage } from './ollama';
import { extractClassification, classificationText, type Classification } from './classification';
import { getMaxConcurrency } from './settings';

// Process jobs at a fast tick but limit concurrent runs via settings
const TICK_MS = 500;
let inFlight = 0;

export function classificationForDuplicate(
  hash: string,
  size: number,
  path: string,
): Classification | undefined {
  const existing = getImageByHashSize(hash, size);
  if (!existing || existing.path === path || !existing.tags_json) return undefined;
  try {
    return extractClassification(existing.tags_json);
  } catch {
    return undefined;
  }
}

async function classifyNew(jobId: number, imagePath: string): Promise<Classification> {
  updateJobStatus(jobId, 'classifying');
  const tagsStr = await classifyImage(imagePath);
  return extractClassification(tagsStr);
}

async function processJob() {
  if (inFlight >= getMaxConcurrency()) return;
  const job = getNextPendingJob();
  if (!job || job.id == null) return;

  // Claim the slot before any await so a fast poll cannot start a second job.
  inFlight++;
  try {
    if (!fs.existsSync(job.path)) {
      updateJobStatus(job.id, 'failed', 'File not found');
      return;
    }

    const stat = fs.statSync(job.path);
    const hash = await hashFile(job.path);
    const now = new Date().toISOString();

    const copied = classificationForDuplicate(hash, stat.size, job.path);
    const parsed = copied ?? (await classifyNew(job.id, job.path));
    const tagsJson = JSON.stringify(parsed);

    const imageId = upsertImage({
      path: job.path,
      size: stat.size,
      hash,
      created_at: now,
      updated_at: now,
      tags_json: tagsJson,
    });

    upsertKv(imageId, parsed);
    upsertFts(imageId, classificationText(parsed));
    updateJobStatus(job.id, 'done', undefined, imageId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Ingest job failed', err);
    updateJobStatus(job.id, 'failed', message.slice(0, 500));
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
}

export function startWorker() {
  const recovered = recoverStuckJobs();
  if (recovered > 0) {
    console.log(`Requeued ${recovered} interrupted ingest job(s)`);
  }
  setInterval(() => {
    void processJob();
  }, TICK_MS);
}
