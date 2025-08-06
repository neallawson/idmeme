export interface ImageRecord {
  id: number;
  path: string;
  size: number;
  hash: string;
  createdAt: string;
  description?: string;
}

export interface AISettings {
  model: string;
  prompt: string;
  temperature: number;
}
