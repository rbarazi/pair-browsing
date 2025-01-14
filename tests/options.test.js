const { saveOptions, restoreOptions, updateVisibility } = require('../options');

describe('options.js', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="provider">
        <option value="openai">OpenAI</option>
        <option value="gemini">Google Gemini</option>
      </select>
      <input type="text" id="openaiKey" />
      <input type="text" id="openaiModel" />
      <input type="text" id="geminiKey" />
      <input type="text" id="geminiModel" />
      <textarea id="systemPrompt"></textarea>
      <input type="checkbox" id="debugMode" />
      <input type="checkbox" id="agentMode" />
      <div id="status"></div>
      <div id="openai-section"></div>
      <div id="gemini-section"></div>
    `;
  });

  describe('saveOptions', () => {
    it('should save options to chrome.storage', () => {
      document.getElementById('provider').value = 'openai';
      document.getElementById('openaiKey').value = 'test-openai-key';
      document.getElementById('openaiModel').value = 'test-openai-model';
      document.getElementById('geminiKey').value = 'test-gemini-key';
      document.getElementById('geminiModel').value = 'test-gemini-model';
      document.getElementById('systemPrompt').value = 'test-system-prompt';
      document.getElementById('debugMode').checked = true;
      document.getElementById('agentMode').checked = true;

      saveOptions();

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        provider: 'openai',
        openai_api_key: 'test-openai-key',
        openai_model: 'test-openai-model',
        gemini_api_key: 'test-gemini-key',
        gemini_model: 'test-gemini-model',
        system_prompt: 'test-system-prompt',
        debug_mode: true,
        agent_mode: true,
      });
    });
  });

  describe('restoreOptions', () => {
    it('should restore options from chrome.storage', () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({
          provider: 'gemini',
          openai_api_key: 'restored-openai-key',
          openai_model: 'restored-openai-model',
          gemini_api_key: 'restored-gemini-key',
          gemini_model: 'restored-gemini-model',
          system_prompt: 'restored-system-prompt',
          debug_mode: false,
          agent_mode: false,
        });
      });

      restoreOptions();

      expect(document.getElementById('provider').value).toBe('gemini');
      expect(document.getElementById('openaiKey').value).toBe('restored-openai-key');
      expect(document.getElementById('openaiModel').value).toBe('restored-openai-model');
      expect(document.getElementById('geminiKey').value).toBe('restored-gemini-key');
      expect(document.getElementById('geminiModel').value).toBe('restored-gemini-model');
      expect(document.getElementById('systemPrompt').value).toBe('restored-system-prompt');
      expect(document.getElementById('debugMode').checked).toBe(false);
      expect(document.getElementById('agentMode').checked).toBe(false);
    });
  });

  describe('updateVisibility', () => {
    it('should show OpenAI section and hide Gemini section when provider is OpenAI', () => {
      document.getElementById('provider').value = 'openai';
      updateVisibility();
      expect(document.getElementById('openai-section').style.display).toBe('block');
      expect(document.getElementById('gemini-section').style.display).toBe('none');
    });

    it('should show Gemini section and hide OpenAI section when provider is Gemini', () => {
      document.getElementById('provider').value = 'gemini';
      updateVisibility();
      expect(document.getElementById('openai-section').style.display).toBe('none');
      expect(document.getElementById('gemini-section').style.display).toBe('block');
    });
  });
});
