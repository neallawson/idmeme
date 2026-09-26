import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractClassification } from '../src/classification.ts';

describe('extractClassification', () => {
  it('reads a fenced JSON object and keeps commas inside text', () => {
    const parsed = extractClassification(`Here you go:
\`\`\`json
{
  "category": "animals",
  "keywords": "cat, keyboard",
  "style": "photo",
  "intent": "Jokes that the cat is working.",
  "characters": ["cat", "Cat"],
  "text": ["Hello, world"]
}
\`\`\`
`);
    assert.equal(parsed.category, 'animals');
    assert.deepEqual(parsed.keywords, ['cat', 'keyboard']);
    assert.deepEqual(parsed.characters, ['cat']);
    assert.deepEqual(parsed.text, ['Hello, world']);
  });

  it('repairs a trailing comma and ignores surrounding prose', () => {
    const parsed = extractClassification(
      'Sure. {"category": "politics", "keywords": ["vote",],} Done.',
    );
    assert.equal(parsed.category, 'politics');
    assert.deepEqual(parsed.keywords, ['vote']);
  });

  it('fails when the reply is not an object or has no usable fields', () => {
    assert.throws(() => extractClassification('not json'), /not JSON/);
    assert.throws(() => extractClassification('{"category":"","keywords":[]}'), /no usable fields/);
  });
});
