import assert from 'node:assert';
import test from 'node:test';

// Stub chrome API surface before importing background.js
const listeners = { runtimeConnect: null, runtimeMessage: null };
const storageState = {};

// minimal chrome stub to satisfy background module wiring
global.chrome = {
  runtime: {
    onConnect: { addListener: (fn) => { listeners.runtimeConnect = fn; } },
    onMessage: { addListener: (fn) => { listeners.runtimeMessage = fn; } },
    onInstalled: { addListener() {} },
    lastError: null,
  },
  storage: {
    local: {
      async get(defaults) {
        return {
          ...defaults,
          openai_api_key: 'test-api-key',
          openai_model: 'gpt-4o-mini',
          system_prompt: 'system-role',
        };
      },
      async set(values) {
        Object.assign(storageState, values);
      },
    },
  },
  action: {
    onClicked: { addListener() {} },
  },
  tabs: {
    onUpdated: { addListener() {} },
    sendMessage: async () => ({ success: true, stringifiedInteractiveElements: '<button>Ok</button>' }),
    query: async () => [{ id: 1, windowId: 1 }],
    get: async () => ({ id: 1, windowId: 1 }),
    captureVisibleTab: async () => 'data:image/png;base64,screenshot',
    update: () => {},
  },
  windows: {
    getCurrent: async () => ({ id: 1 }),
  },
  scripting: { executeScript: async () => ({}) },
};

global.sidebarPort = null;

const fetchCalls = [];

global.fetch = async (url, options) => {
  fetchCalls.push({ url, options });
  return {
    ok: true,
    async json() {
      return { choices: [{ message: { content: '{"ok":true}' } }] };
    },
  };
};

const { conversationStorage } = await import('../storage.js');
const background = await import('../background.js');
const { __BACKGROUND_TESTING__ } = global;

const baseHistory = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi!' },
  {
    role: 'user',
    content: 'Take a screenshot',
    elements: '<a>Link</a>',
    screenshot: 'data:image/png;base64,abc',
  },
];

conversationStorage.getAllHistory = async () => baseHistory;

test('getLastHistoryEntry guards empty histories', () => {
  assert.throws(() => __BACKGROUND_TESTING__.getLastHistoryEntry([]), /Conversation history is empty/);
});

test('ensureLastMessageHasScreenshot enforces screenshots', () => {
  assert.throws(
    () => __BACKGROUND_TESTING__.ensureLastMessageHasScreenshot({ role: 'user', content: 'hello' }),
    /Latest history entry is missing a screenshot/
  );
});

test('getProviderReadyHistory validates presence of history screenshots', async () => {
  conversationStorage.getAllHistory = async () => [{ role: 'user', content: 'missing screenshot' }];

  await assert.rejects(
    () => __BACKGROUND_TESTING__.getProviderReadyHistory(),
    /Latest history entry is missing a screenshot/
  );

  conversationStorage.getAllHistory = async () => baseHistory;
});

test('sendToOpenAI builds structured messages with screenshot content', async () => {
  const result = await __BACKGROUND_TESTING__.sendToOpenAI();
  assert.deepStrictEqual(result, { response: '{"ok":true}', success: true });

  assert.strictEqual(fetchCalls.length, 1);
  const request = fetchCalls[0];
  assert.strictEqual(request.url, 'https://api.openai.com/v1/chat/completions');

  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.model, 'gpt-4o-mini');
  assert.strictEqual(body.messages[0].content, 'system-role');

  const [userMessage, assistantMessage, finalPrompt] = body.messages.slice(1);
  assert.deepStrictEqual(userMessage, { role: 'user', content: 'Hello' });
  assert.deepStrictEqual(assistantMessage, { role: 'assistant', content: 'Hi!' });
  assert.strictEqual(finalPrompt.role, 'user');
  assert.ok(Array.isArray(finalPrompt.content));

  const [textPart, imagePart] = finalPrompt.content;
  assert.ok(textPart.text.includes('<interactive_elements><a>Link</a></interactive_elements>'));
  assert.strictEqual(imagePart.image_url.url, 'data:image/png;base64,abc');
});

test('sendToOllama mirrors history structure with screenshots intact', async () => {
  fetchCalls.length = 0;
  const result = await __BACKGROUND_TESTING__.sendToOllama();
  assert.deepStrictEqual(result, { response: '{"ok":true}', success: true });

  const request = fetchCalls.at(-1);
  const body = JSON.parse(request.options.body);
  const finalPrompt = body.messages.at(-1);

  assert.strictEqual(body.model, 'llama3.2-vision');
  assert.ok(finalPrompt.content[0].text.includes('Interactive elements:'));
  assert.strictEqual(finalPrompt.content[1].image_url, 'data:image/png;base64,abc');
});

test('sendToGemini fails fast when no authentication is configured', async () => {
  fetchCalls.length = 0;
  await assert.rejects(
    () => __BACKGROUND_TESTING__.sendToGemini(),
    /Gemini API key not set/
  );
  assert.strictEqual(fetchCalls.length, 0);
});
