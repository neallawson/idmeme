const SNIPPET_LEN = 240;

function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= SNIPPET_LEN) return oneLine;
  return `${oneLine.slice(0, SNIPPET_LEN)}…`;
}

function unwrapFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (match ? match[1] : text).trim();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Models often leave a trailing comma before the closing brace.
    return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
  }
}

export function extractClassification(raw: string): Classification {
  const text = unwrapFence(raw ?? '');
  if (!text) throw new Error('empty AI result');

  let parsed: unknown;
  try {
    parsed = parseJson(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error(`AI result was not JSON: ${snippet(text)}`);
    }
    try {
      parsed = parseJson(text.slice(start, end + 1));
    } catch {
      throw new Error(`AI result was not valid JSON: ${snippet(text)}`);
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI result JSON was not an object');
  }
  return normalizeClassification(parsed as Record<string, unknown>);
}

export interface Classification {
  category: string;
  keywords: string[];
  style: string;
  intent: string;
  characters: string[];
  text: string[];
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(asString).filter(Boolean).join(' ');
  return '';
}

function asStringList(value: unknown, splitCommas: boolean): string[] {
  const parts: string[] = [];
  const push = (item: string) => {
    const text = item.replace(/\s+/g, ' ').trim();
    if (text && text !== '...') parts.push(text);
  };
  const absorb = (item: unknown) => {
    if (typeof item === 'string') {
      const pieces = splitCommas ? item.split(',') : item.split(/\n+/);
      pieces.forEach(push);
      return;
    }
    push(asString(item));
  };
  if (Array.isArray(value)) value.forEach(absorb);
  else absorb(value);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  return unique;
}

export function normalizeClassification(raw: Record<string, unknown>): Classification {
  const categoryWords = asString(raw.category).split(' ').filter(Boolean).slice(0, 3);
  const classification: Classification = {
    category: categoryWords.join(' ').replace(/[.,:;]+$/g, ''),
    keywords: asStringList(raw.keywords, true),
    style: asString(raw.style).replace(/[.,:;]+$/g, ''),
    intent: asString(raw.intent),
    characters: asStringList(raw.characters, true),
    text: asStringList(raw.text, false),
  };
  const empty =
    !classification.category &&
    classification.keywords.length === 0 &&
    !classification.style &&
    !classification.intent &&
    classification.characters.length === 0 &&
    classification.text.length === 0;
  if (empty) throw new Error('AI result had no usable fields');
  return classification;
}

function flattenText(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (typeof value === 'object')
    return Object.values(value as Record<string, unknown>).flatMap(flattenText);
  return [];
}

export function classificationText(parsed: Classification): string {
  return flattenText(parsed).join(' ');
}
