export interface ImageRecord {
  id: number;
  path: string;
  size: number;
  hash: string;
  created_at: string;
  updated_at: string;
  tags_json?: string;
}

export interface AISettings {
  model: string;
  temperature: number;
  maxConcurrency: number;
}

export interface IngestBatch {
  id: number;
  folder: string;
  recursive: boolean;
  status: 'running' | 'paused' | 'complete';
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
}

export interface IngestBatchDetail extends IngestBatch {
  current: { id: number; path: string; status: string; started_at?: string | null }[];
  failures: { id: number; path: string; error?: string | null }[];
}
