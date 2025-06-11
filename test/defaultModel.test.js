import fs from 'fs/promises';
import assert from 'node:assert';
import test from 'node:test';

const filePath = new URL('../background.js', import.meta.url);

 test('background.js uses correct OpenAI model default', async () => {
  const content = await fs.readFile(filePath, 'utf8');
  assert.ok(content.includes('openai_model: "gpt-4o-mini"'));
 });
