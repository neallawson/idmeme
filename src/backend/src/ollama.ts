import path from 'path';
import fs from 'fs';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

// Send a vision prompt to Ollama using the llava chat/completions endpoint
import { getPrompt } from './settings';

export async function classifyImage(imagePath: string): Promise<string | undefined> {
  try {
    const imgB64 = fs.readFileSync(imagePath).toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff'
    };
    const mime = mimeMap[ext] ?? 'image/jpeg';

    const body = {
      model: process.env.OLLAMA_MODEL ?? 'llava:latest',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: getPrompt() },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${imgB64}` }
            }
          ]
        }
      ],
      stream: false
    };

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 120_000); // 2 minutes

    const resp = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(id);

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Ollama responded ${resp.status}: ${errText}`);
    }

    // Response shape: { choices: [ { message: { content: 'tags' } } ] }
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || undefined;
  } catch (err) {
    console.error('classifyImage error', err);
    return undefined;
  }
}
