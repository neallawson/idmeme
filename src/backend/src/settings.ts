import fs from 'fs';
import path from 'path';

const CONFIG_PATH = process.env.IDMEME_CONFIG ?? path.join(process.cwd(), 'config.json');

export const DEFAULT_PROMPT = `You are an expert meme analyst being called upon to help analyze and classify images so that a search engine can\
find them later. Here is the name and description of the fields that will comprise your response. The format of the response follows after this list. \
Field "category" is one word best describing the main category of the meme.  Field "keywords" is for key concepts, actions, locations, and actors present \
in the meme. Field "style" lists the artistic style(s)/medium of the meme. Field "intent": Memes are often clever, sarcastic, ironic, satirical, \
or otherwise complex and creative. Try to discern the intent of the meme (examples: to mock some person or organization, making fun of a news headline, \
making a pun, etc.) and store a short description in the "intent" field. Field "characters": List any recognizable characters in "characters" so searching \
for people or institutions finds relevant memes. Field "text": Memes also feature quotes and text that is insightful in discerning the meaning. Include \
the exact quotations you see in the "text" field. Return ONLY valid JSON matching this schema:
{
  "category": "<one main category word>",
  "keywords": ["word1","word2",...],
  "style": "<artistic style/medium>",
  "intent": "<what point(s) is the meme trying to make and how.>"
  "characters": ["name1", ...],
  "text": ["exact phrase/text", ...]
}
If a field is not present, or is not relevant, use an empty string or empty array. Empty fields are ok. Do not wrap the JSON in markdown or \
any extra text. Do not describe your role or other irrelevant information. Take your time to analyze the image and return a valid JSON object.`;

interface Config {
  prompt?: string;
  maxConcurrency?: number;
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
