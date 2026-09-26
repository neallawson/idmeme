import fs from 'fs';
import path from 'path';

const CONFIG_PATH = process.env.IDMEME_CONFIG ?? path.join(process.cwd(), 'config.json');

export const DEFAULT_MODEL = 'qwen3-vl:latest';
export const DEFAULT_TEMPERATURE = 0.2;

export const DEFAULT_PROMPT = `You are classifying a meme image for a search engine. Look at the picture and read every piece of text in it. Return ONLY a JSON object with these fields and no others:
- category: one or two words for the main subject, such as "politics", "animals", or "wordplay".
- keywords: short searchable terms for the concepts, actions, places, and objects that matter. Each term is its own string.
- style: the medium or visual style, such as "photo", "cartoon", "screenshot", or "comic".
- intent: one or two sentences on what the meme is doing, such as mocking a person, answering a headline, or making a pun.
- characters: recognizable people, animals, or institutions. When you do not know a name, use a role such as "man", "woman", "painter", or "chef".
- text: each distinct piece of visible wording, copied exactly, as its own string. Use an empty array when the image has no text.

Example of the shape, not of the content:
{
  "category": "animals",
  "keywords": ["cat", "keyboard", "office"],
  "style": "photo",
  "intent": "Jokes that the cat is working at the computer.",
  "characters": ["cat"],
  "text": ["I have to work tomorrow"]
}
Use an empty string or an empty array when a field does not apply. Do not wrap the JSON in markdown. Do not add commentary.`;

interface Config {
  prompt?: string;
  maxConcurrency?: number;
  model?: string;
  temperature?: number;
}

function readConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Config;
    }
  } catch (err) {
    console.error('settings read error', err);
  }
  return {};
}

function writeConfig(cfg: Config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error('settings write error', err);
  }
}

export function getPrompt(): string {
  const env = process.env.OLLAMA_PROMPT;
  if (env) return env;
  const cfg = readConfig();
  return cfg.prompt ?? DEFAULT_PROMPT;
}

export function setPrompt(newPrompt: string | undefined) {
  const cfg = readConfig();
  if (!newPrompt) {
    delete cfg.prompt;
  } else {
    cfg.prompt = newPrompt;
  }
  writeConfig(cfg);
}

export function getMaxConcurrency(): number {
  const envVar = process.env.IDMEME_MAX_CONCURRENCY;
  if (envVar) {
    const n = Number(envVar);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  const cfg = readConfig();
  const n = cfg.maxConcurrency;
  return n && n >= 1 ? n : 1;
}

export function setMaxConcurrency(n: number) {
  if (!Number.isFinite(n) || n < 1) return;
  const cfg = readConfig();
  cfg.maxConcurrency = Math.floor(n);
  writeConfig(cfg);
}

function clampTemperature(n: number): number {
  return Math.min(2, Math.max(0, n));
}

export function getModel(): string {
  const env = process.env.OLLAMA_MODEL?.trim();
  if (env) return env;
  const cfg = readConfig().model?.trim();
  return cfg || DEFAULT_MODEL;
}

export function setModel(model: string | undefined) {
  const cfg = readConfig();
  const trimmed = model?.trim();
  if (!trimmed || trimmed === DEFAULT_MODEL) delete cfg.model;
  else cfg.model = trimmed;
  writeConfig(cfg);
}

export function getTemperature(): number {
  const env = process.env.OLLAMA_TEMPERATURE;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n)) return clampTemperature(n);
  }
  const cfg = readConfig().temperature;
  if (typeof cfg === 'number' && Number.isFinite(cfg)) return clampTemperature(cfg);
  return DEFAULT_TEMPERATURE;
}

export function setTemperature(n: number) {
  if (!Number.isFinite(n)) return;
  const cfg = readConfig();
  const clamped = clampTemperature(n);
  if (clamped === DEFAULT_TEMPERATURE) delete cfg.temperature;
  else cfg.temperature = clamped;
  writeConfig(cfg);
}
