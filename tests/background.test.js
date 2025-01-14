const { getOpenAIKey, setOpenAIKey, cleanupExtensionMarkup, waitForPageLoad, handleScreenshotCapture } = require('../background');
const { chrome } = require('jest-chrome');

describe('background.js', () => {
  describe('getOpenAIKey', () => {
    it('should retrieve the OpenAI API key from storage', async () => {
      chrome.storage.local.get.mockResolvedValue({ openai_api_key: 'test-key' });
      const apiKey = await getOpenAIKey();
      expect(apiKey).toBe('test-key');
    });
  });

  describe('setOpenAIKey', () => {
    it('should set the OpenAI API key in storage', async () => {
      await setOpenAIKey('new-test-key');
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ openai_api_key: 'new-test-key' });
    });
  });

  describe('cleanupExtensionMarkup', () => {
    it('should send a CLEANUP_MARKUP message to the specified tab', async () => {
      chrome.tabs.sendMessage.mockResolvedValue();
      await cleanupExtensionMarkup(123);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, { type: 'CLEANUP_MARKUP' });
    });
  });

  describe('waitForPageLoad', () => {
    it('should resolve when the page is fully loaded', async () => {
      chrome.tabs.get.mockResolvedValue({ status: 'complete' });
      chrome.tabs.sendMessage.mockResolvedValue({ ready: true });
      await waitForPageLoad(123);
      expect(chrome.tabs.get).toHaveBeenCalledWith(123);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, { type: 'CHECK_DOCUMENT_READY' });
    });
  });

  describe('handleScreenshotCapture', () => {
    it('should capture a screenshot and send it to the AI service', async () => {
      chrome.tabs.get.mockResolvedValue({ id: 123, windowId: 456 });
      chrome.tabs.captureVisibleTab.mockResolvedValue('screenshot-url');
      chrome.storage.local.get.mockResolvedValue({ debug_mode: false });
      const response = await handleScreenshotCapture('test-prompt', 123);
      expect(response.success).toBe(true);
      expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(456, { format: 'png' });
    });
  });

  describe('Event Listeners', () => {
    it('should handle connection from sidebar', () => {
      const port = { name: 'sidebar', onDisconnect: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() } };
      chrome.runtime.onConnect.addListener.mock.calls[0][0](port);
      expect(port.onDisconnect.addListener).toHaveBeenCalled();
      expect(port.onMessage.addListener).toHaveBeenCalled();
    });

    it('should handle messages from content script', () => {
      const sendResponse = jest.fn();
      chrome.runtime.onMessage.addListener.mock.calls[0][0]({ type: 'SET_OPENAI_KEY', apiKey: 'test-key' }, {}, sendResponse);
      expect(setOpenAIKey).toHaveBeenCalledWith('test-key');
    });
  });
});
