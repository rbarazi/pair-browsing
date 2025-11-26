import assert from 'node:assert';
import test from 'node:test';

const elements = {};
const listeners = {};

function createElement(id, initial = {}) {
  const el = {
    id,
    value: initial.value ?? '',
    checked: initial.checked ?? false,
    style: initial.style ?? {},
    textContent: initial.textContent ?? '',
    className: initial.className ?? '',
    addEventListener: (event, handler) => {
      listeners[`${id}:${event}`] = handler;
    },
  };
  elements[id] = el;
  return el;
}

createElement('provider', { value: '' });
createElement('openaiKey');
createElement('openaiModel');
createElement('geminiKey');
createElement('geminiModel');
createElement('geminiUseIdentity', { checked: false });
createElement('ollamaModel');
createElement('systemPrompt');
createElement('debugMode', { checked: false });
createElement('agentMode', { checked: false });
createElement('cursorLabel');
createElement('status');
createElement('openai-section', { style: {} });
createElement('gemini-section', { style: {} });
createElement('ollama-section', { style: {} });
createElement('save');

// Stub document and chrome before importing the module
global.document = {
  getElementById: (id) => elements[id],
  addEventListener: (event, handler) => {
    listeners[event] = handler;
  },
};

const stored = {
  provider: 'gemini',
  openai_api_key: 'openai-key',
  openai_model: 'gpt-4o-mini',
  gemini_api_key: 'gemini-key',
  gemini_model: 'gemini-2.0-flash-exp',
  gemini_use_identity: true,
  ollama_model: 'llama3.2-vision',
  system_prompt: 'remember this',
  debug_mode: true,
  agent_mode: true,
  cursor_label: 'Helper',
};

global.chrome = {
  storage: {
    local: {
      get(defaults, cb) {
        cb({ ...defaults, ...stored });
      },
      set(values, cb) {
        Object.assign(stored, values);
        cb?.();
      },
    },
  },
};

await import('../options.js');
const { __OPTIONS_TESTING__ } = global;

test('restoreOptions hydrates fields from chrome storage', () => {
  __OPTIONS_TESTING__.restoreOptions();

  assert.strictEqual(elements.provider.value, 'gemini');
  assert.strictEqual(elements.geminiKey.value, 'gemini-key');
  assert.strictEqual(elements.geminiUseIdentity.checked, true);
  assert.strictEqual(elements.systemPrompt.value, 'remember this');
  assert.strictEqual(elements.debugMode.checked, true);
  assert.strictEqual(elements.agentMode.checked, true);
  assert.strictEqual(elements.cursorLabel.value, 'Helper');

  assert.strictEqual(elements['gemini-section'].style.display, 'block');
  assert.strictEqual(elements['openai-section'].style.display, 'none');
});

test('saveOptions persists values and applies defaults', () => {
  elements.provider.value = '';
  elements.geminiUseIdentity.checked = false;
  elements.cursorLabel.value = '';
  elements.systemPrompt.value = '';

  __OPTIONS_TESTING__.saveOptions();

  assert.strictEqual(stored.provider, __OPTIONS_TESTING__.DEFAULT_OPTIONS.provider);
  assert.strictEqual(stored.gemini_use_identity, false);
  assert.strictEqual(stored.cursor_label, __OPTIONS_TESTING__.DEFAULT_OPTIONS.cursor_label);
  assert.strictEqual(stored.system_prompt, __OPTIONS_TESTING__.DEFAULT_OPTIONS.system_prompt);
  assert.strictEqual(elements.status.textContent, 'Options saved.');
  assert.strictEqual(elements.status.className, 'success');
});

test('updateVisibility toggles provider sections', () => {
  elements.provider.value = 'ollama';
  __OPTIONS_TESTING__.updateVisibility();
  assert.strictEqual(elements['ollama-section'].style.display, 'block');
  assert.strictEqual(elements['openai-section'].style.display, 'none');
  assert.strictEqual(elements['gemini-section'].style.display, 'none');
});
