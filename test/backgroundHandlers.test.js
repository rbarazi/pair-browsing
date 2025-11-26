import fs from 'fs/promises';
import assert from 'node:assert';
import test from 'node:test';

const filePath = new URL('../background.js', import.meta.url);

test('promptAI starts with zero step counter', async () => {
  const content = await fs.readFile(filePath, 'utf8');
  assert.match(
    content,
    /promptAI\s*\(\s*message\.prompt,\s*tab\.id,\s*port,\s*0\s*\)/m
  );
});

test('sendPromptAndScreenshotToServer waits for history updates', async () => {
  const content = await fs.readFile(filePath, 'utf8');
  assert.match(
    content,
    /async function sendPromptAndScreenshotToServer[\s\S]*await updateHistory\(/m
  );
});

test('Gemini configuration supports Chrome identity fallback', async () => {
  const content = await fs.readFile(filePath, 'utf8');
  assert.match(content, /gemini_use_identity/);
  assert.match(content, /getAuthToken/);
  assert.match(content, /x-goog-api-key/);
});

test('OpenAI requests keep assistant turns and content intact', async () => {
  const content = await fs.readFile(filePath, 'utf8');
  assert.match(
    content,
    /role: "assistant",\s*\n\s*content: message\.content/
  );
  assert.match(
    content,
    /<interactive_elements>\$\{lastMessage\.elements \|\| ''\}<\/interactive_elements>/
  );
});

test('Gemini identity attempts silent auth before interactive prompts', async () => {
  const content = await fs.readFile(filePath, 'utf8');
  assert.match(content, /requestToken\(false\)/);
  assert.match(content, /requestToken\(true\)/);
  assert.match(content, /Silent Gemini authorization failed/);
});

test('History validation surfaces missing screenshot errors', async () => {
  const content = await fs.readFile(filePath, 'utf8');
  assert.match(content, /Latest history entry is missing a screenshot for provider request\./);
});
