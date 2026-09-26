import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const root = path.join(tmpdir(), `idmeme-test-${randomBytes(4).toString('hex')}`);
mkdirSync(root);
process.env.DB_FILE = path.join(root, 'test.sqlite');
process.env.IDMEME_CONFIG = path.join(root, 'config.json');

const {
  ingestFolderBatch,
  setBatchStatus,
  getNextPendingJob,
  updateJobStatus,
  retryFailed,
  getBatch,
  upsertImage,
  upsertKv,
  upsertFts,
  searchImagesAdvanced,
} = await import('../src/db.ts');

function touch(dir: string, name: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, name);
  return filePath;
}

describe('database', { concurrency: false }, () => {
  it('opens an existing folder batch instead of queueing the files again', () => {
    const dir = path.join(root, 'media');
    mkdirSync(dir);
    const filePath = touch(dir, 'one.jpg');
    const created = ingestFolderBatch(dir, false, [filePath]);
    const again = ingestFolderBatch(`${dir}/`, false, [filePath]);
    assert.equal(created.created, true);
    assert.equal(created.queued, 1);
    assert.equal(again.created, false);
    assert.equal(again.queued, 0);
    assert.equal(again.batch.id, created.batch.id);
    assert.equal(again.batch.total, 1);
  });

  it('does not take jobs from a paused batch, and retry resets only failed rows', () => {
    const dir = path.join(root, 'paused');
    mkdirSync(dir);
    const first = touch(dir, 'a.jpg');
    const second = touch(dir, 'b.jpg');
    const { batch } = ingestFolderBatch(dir, false, [first, second]);
    assert.equal(getBatch(batch.id)?.status, 'running');

    setBatchStatus(batch.id, 'paused');
    assert.equal(getNextPendingJob(), undefined);

    setBatchStatus(batch.id, 'running');
    const job = getNextPendingJob();
    assert.ok(job?.id);
    updateJobStatus(job.id, 'failed', 'model crashed');
    const beforeRetry = getBatch(batch.id);
    assert.equal(beforeRetry?.failed, 1);
    assert.equal(beforeRetry?.pending, 1);

    assert.equal(retryFailed(batch.id), 1);
    const afterRetry = getBatch(batch.id);
    assert.equal(afterRetry?.failed, 0);
    assert.equal(afterRetry?.pending, 2);

    const claimed = getNextPendingJob();
    assert.ok(claimed?.id);
    updateJobStatus(claimed.id, 'done');
    assert.equal(retryFailed(batch.id), 0);
    assert.equal(getBatch(batch.id)?.done, 1);
  });

  it('matches a whole phrase and requires every comma-separated term', () => {
    const woman = upsertImage({
      path: path.join(root, 'woman.jpg'),
      size: 10,
      hash: 'woman',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      tags_json: '{}',
    });
    upsertKv(woman, { characters: ['woman'] });
    upsertFts(woman, 'woman');

    const man = upsertImage({
      path: path.join(root, 'man.jpg'),
      size: 11,
      hash: 'man',
      created_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
      tags_json: '{}',
    });
    upsertKv(man, { characters: ['man'], keywords: ['cat'] });
    upsertFts(man, 'man cat');

    assert.equal(searchImagesAdvanced({ characters: 'man' }).length, 1);
    assert.equal(
      searchImagesAdvanced({ characters: 'woman' }).some((row) => row.id === woman),
      true,
    );
    assert.equal(
      searchImagesAdvanced({ characters: 'man' }).some((row) => row.id === woman),
      false,
    );
    assert.equal(searchImagesAdvanced({ characters: 'man', keywords: 'cat' }).length, 1);
    assert.equal(searchImagesAdvanced({ characters: 'woman, cat' }).length, 0);
    assert.equal(searchImagesAdvanced({}, 'cat').length, 1);
    assert.throws(() => searchImagesAdvanced({}, '"'), /unterminated string|fts5/i);
  });
});
