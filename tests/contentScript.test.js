const { JSDOM } = require('jsdom');
const { buildDomTree, getElementByIndex, findElementBySelector, initializeCursor, animateCursorTo, handleClick, handleFill, cleanupExtensionMarkup } = require('../contentScript');

describe('contentScript.js', () => {
  let dom;
  let document;
  let window;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
    document = dom.window.document;
    window = dom.window;
    global.document = document;
    global.window = window;
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('buildDomTree', () => {
    it('should build a DOM tree with interactive elements', async () => {
      document.body.innerHTML = `
        <div>
          <button id="btn1">Button 1</button>
          <a href="#" id="link1">Link 1</a>
        </div>
      `;
      const tree = await buildDomTree(document.body);
      expect(tree).toBeDefined();
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].children.length).toBe(2);
    });
  });

  describe('getElementByIndex', () => {
    it('should return the correct element by index', () => {
      document.body.innerHTML = `
        <div>
          <button id="btn1">Button 1</button>
          <a href="#" id="link1">Link 1</a>
        </div>
      `;
      buildDomTree(document.body);
      const element = getElementByIndex(1);
      expect(element).toBeDefined();
      expect(element.id).toBe('link1');
    });
  });

  describe('findElementBySelector', () => {
    it('should find element by CSS selector', () => {
      document.body.innerHTML = `<div id="test">Test</div>`;
      const element = findElementBySelector('#test');
      expect(element).toBeDefined();
      expect(element.id).toBe('test');
    });

    it('should find element by XPath', () => {
      document.body.innerHTML = `<div id="test">Test</div>`;
      const element = findElementBySelector('//*[@id="test"]');
      expect(element).toBeDefined();
      expect(element.id).toBe('test');
    });
  });

  describe('initializeCursor', () => {
    it('should initialize cursor in the middle of the viewport', () => {
      initializeCursor();
      const cursor = document.querySelector('div');
      expect(cursor).toBeDefined();
      expect(cursor.style.transform).toContain('translate');
    });
  });

  describe('animateCursorTo', () => {
    it('should animate cursor to target position', async () => {
      initializeCursor();
      await animateCursorTo(100, 100);
      const cursor = document.querySelector('div');
      expect(cursor.style.transform).toContain('translate(100px, 100px)');
    });
  });

  describe('handleClick', () => {
    it('should handle click on element', async () => {
      document.body.innerHTML = `<button id="btn1">Button 1</button>`;
      const button = document.getElementById('btn1');
      const clickSpy = jest.spyOn(button, 'click');
      await handleClick('#btn1');
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('handleFill', () => {
    it('should handle fill on input element', async () => {
      document.body.innerHTML = `<input id="input1" type="text" />`;
      const input = document.getElementById('input1');
      await handleFill('#input1', 'test value');
      expect(input.value).toBe('test value');
    });
  });

  describe('cleanupExtensionMarkup', () => {
    it('should cleanup extension markup', () => {
      document.body.innerHTML = `
        <div id="cursor"></div>
        <div style="position: absolute; z-index: 999999;"></div>
        <div style="position: fixed; z-index: 10000;"></div>
        <div style="position: fixed; border-radius: 50%;"></div>
      `;
      cleanupExtensionMarkup();
      expect(document.querySelector('#cursor')).toBeNull();
      expect(document.querySelectorAll('div[style*="position: absolute"][style*="z-index: 999999"]').length).toBe(0);
      expect(document.querySelectorAll('div[style*="position: fixed"][style*="z-index: 10000"]').length).toBe(0);
      expect(document.querySelectorAll('div[style*="position: fixed"][style*="border-radius: 50%"]').length).toBe(0);
    });
  });
});
