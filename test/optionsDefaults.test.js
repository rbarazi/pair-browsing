import fs from 'fs/promises';
import assert from 'node:assert';
import test from 'node:test';
import vm from 'node:vm';

const filePath = new URL('../options.js', import.meta.url);

test('options.js exposes expected DEFAULT_OPTIONS values', async () => {
  let content = await fs.readFile(filePath, 'utf8');
  // expose the constant on the global object so we can inspect it
  content = content.replace(
    'const DEFAULT_OPTIONS = {',
    'globalThis.DEFAULT_OPTIONS = {'
  );

  const context = {
    chrome: { storage: { local: { get: async () => ({}), set: () => {} } } },
    document: {
      getElementById: () => ({
        addEventListener() {},
        value: '',
        checked: false,
        style: {},
      }),
      addEventListener() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(content, context);

  const defaults = context.DEFAULT_OPTIONS;

  assert.strictEqual(defaults.provider, 'openai');
  assert.strictEqual(defaults.openai_model, 'gpt-4o-mini');
  assert.strictEqual(defaults.gemini_model, 'gemini-2.0-flash-exp');
  assert.strictEqual(defaults.ollama_model, 'llama3.2-vision');
});
