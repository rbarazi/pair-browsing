const { JSDOM } = require('jsdom');
const { expect } = require('@jest/globals');
const { chrome } = require('jest-chrome');

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../sidebar.html'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../sidebar.css'), 'utf8');
const js = fs.readFileSync(path.resolve(__dirname, '../sidebar.js'), 'utf8');

let window, document;

beforeEach(() => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
  });

  window = dom.window;
  document = window.document;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const scriptEl = document.createElement('script');
  scriptEl.textContent = js;
  document.body.appendChild(scriptEl);
});

describe('Sidebar Tests', () => {
  test('connectToBackground function', () => {
    const connectToBackground = window.connectToBackground;
    expect(connectToBackground).toBeDefined();
    expect(typeof connectToBackground).toBe('function');
  });

  test('ensureConnection function', () => {
    const ensureConnection = window.ensureConnection;
    expect(ensureConnection).toBeDefined();
    expect(typeof ensureConnection).toBe('function');
  });

  test('addMessage function', () => {
    const addMessage = window.addMessage;
    expect(addMessage).toBeDefined();
    expect(typeof addMessage).toBe('function');

    addMessage('Test message', true);
    const messages = document.querySelectorAll('.message');
    expect(messages.length).toBe(1);
    expect(messages[0].textContent).toBe('Test message');
  });

  test('debugLog function', async () => {
    const debugLog = window.debugLog;
    expect(debugLog).toBeDefined();
    expect(typeof debugLog).toBe('function');

    await debugLog('Debug message');
    const messages = document.querySelectorAll('.message');
    expect(messages.length).toBe(1);
    expect(messages[0].textContent).toBe('Debug message');
  });

  test('handlePortMessage function', () => {
    const handlePortMessage = window.handlePortMessage;
    expect(handlePortMessage).toBeDefined();
    expect(typeof handlePortMessage).toBe('function');
  });

  test('displayAIResponse function', () => {
    const displayAIResponse = window.displayAIResponse;
    expect(displayAIResponse).toBeDefined();
    expect(typeof displayAIResponse).toBe('function');

    const clickData = {
      description: 'Click the login button',
      index: 1,
    };

    displayAIResponse(clickData);
    const messages = document.querySelectorAll('.message');
    expect(messages.length).toBe(1);
    expect(messages[0].textContent).toBe('Assistant: Click the login button');
  });
});
