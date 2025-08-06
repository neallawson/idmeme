import path from 'path';
import fs from 'fs';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

// Send a vision prompt to Ollama using the llava chat/completions endpoint
const DEFAULT_PROMPT = `You are an expert in dank memes. Describe the meme in concise comma-separated keywords. Focus on the theme, style, characters and objects. If the image contains text, output all identified text in the image in double quotes.`;
// const DEFAULT_PROMPT = `You are an image-tagging assistant. Describe the image in concise comma-separated keywords. Focus on objects, setting, style, and notable attributes. If the image contains text, output all identified text in the image in double quotes as it is spelled and punctuated.`;

export async function classifyImage(imagePath: string): Promise<string | undefined> {
  try {
    const imgB64 = fs.readFileSync(imagePath).toString('base64');

    const body = {
      model: process.env.OLLAMA_MODEL ?? 'llava:latest',
      messages: [
        {
          role: 'user',
          content: process.env.OLLAMA_PROMPT ?? DEFAULT_PROMPT
        }
      ],
      images: [imgB64],
      stream: false
    };

    const resp = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

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
