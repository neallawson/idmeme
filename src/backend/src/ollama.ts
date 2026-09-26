import { getModel, getPrompt, getTemperature } from './settings';
import { prepareImageForModel } from './imagePrep';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

// Cold-start of a multi-gigabyte vision model can take a couple of minutes.
const REQUEST_TIMEOUT_MS = 300_000;

export async function classifyImage(imagePath: string): Promise<string> {
  try {
    const prepared = await prepareImageForModel(imagePath);
    const payload = {
      model: getModel(),
      stream: false,
      messages: [
        {
          role: 'user',
          content: getPrompt(),
          images: [prepared.base64]
        }
      ],
      options: { temperature: getTemperature() }
    };

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(id);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Ollama responded ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await resp.json()) as { message?: { content?: string } };
    const content = data.message?.content?.trim();
    if (!content) throw new Error('empty AI result');
    return content;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Ollama request timed out');
    }
    const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
    if (err instanceof Error && cause instanceof Error && cause.message) {
      throw new Error(`Ollama request failed: ${cause.message}`);
    }
    throw err;
  }
}
