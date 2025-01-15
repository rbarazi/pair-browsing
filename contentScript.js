// contentScript.js

// Keep track of the cursor element
let cursorElement = null;

// Add a global map to store interactive elements by index
let interactiveElementsMap = [];
let doHighlightElements =  0;

// Function to reset the interactive elements tracking
function resetInteractiveElements() {
  interactiveElementsMap = [];
  currentHighlightIndex = 0;
}

// Function to get element by index
function getElementByIndex(index) {
  console.log("Getting element by index:", index);
  const elementData = interactiveElementsMap[index];
  console.log("Interactive elements map:", elementData);
  return elementData ? getLocateElement(elementData) : null;
  // return elementData ? findElementBySelector(elementData.xpath) : null;
}

// ==========================================================
// 1) Utility to build a CSS selector from an element object
//    (similar to the earlier snippet):
// ==========================================================
function convertSimpleXPathToCssSelector(xpath) {
  if (!xpath) return '';

  // Remove leading slashes
  const normalized = xpath.replace(/^\/+/, '');
  const parts = normalized.split('/');
  const cssParts = [];

  for (const part of parts) {
    if (!part) continue;

    if (part.includes('[')) {
      // Something like div[1], div[last()]
      const bracketIndex = part.indexOf('[');
      let basePart = part.slice(0, bracketIndex);
      const indexPart = part.slice(bracketIndex);
      // e.g. "[1][2]" => split on ']' => ["[1","[2",""]
      const indices = indexPart.split(']').filter(Boolean).map(s => s.replace('[', ''));

      for (const idx of indices) {
        if (/^\d+$/.test(idx)) {
          const num = parseInt(idx, 10);
          basePart += `:nth-of-type(${num})`;
        } else if (idx === 'last()') {
          basePart += ':last-of-type';
        } else if (idx.includes('position()') && idx.includes('>1')) {
          basePart += ':nth-of-type(n+2)';
        }
      }
      cssParts.push(basePart);
    } else {
      cssParts.push(part);
    }
  }

  return cssParts.join(' > ');
}

// Some set of "safe" attributes you want to include in the selector:
const SAFE_ATTRIBUTES = new Set([
  'id',
  'name',
  'type',
  'value',
  'placeholder',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'role',
  'for',
  'autocomplete',
  'required',
  'readonly',
  'alt',
  'title',
  'src',
  'data-testid',
  'data-id',
  'data-qa',
  'data-cy',
  'href',
  'target',
]);

const VALID_CLASS_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

/**
 * Builds a more descriptive CSS selector from:
 *   - The element's XPath (converted)
 *   - Classes
 *   - Additional "safe" attributes
 */
function enhancedCssSelectorForElement(element) {
  try {
    let cssSelector = convertSimpleXPathToCssSelector(element.xpath);

    // If there's a class attribute, append valid class names
    if (element.attributes && element.attributes.class) {
      const classes = element.attributes.class.split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        if (VALID_CLASS_NAME_REGEX.test(cls)) {
          cssSelector += `.${cls}`;
        }
      }
    }

    // Append additional safe attributes
    for (const [attr, value] of Object.entries(element.attributes || {})) {
      // skip class (already handled)
      if (attr === 'class') continue;
      if (!attr.trim()) continue;  // skip empty attribute name
      if (!SAFE_ATTRIBUTES.has(attr)) continue;

      // escape colons in attribute name
      const safeAttr = attr.replace(':', '\\:');

      if (value === '') {
        // e.g. [required], [checked], ...
        cssSelector += `[${safeAttr}]`;
      } else if (/["'<>`]/.test(value)) {
        // If special chars, do a "contains" match
        const safeValue = value.replace(/"/g, '\\"');
        cssSelector += `[${safeAttr}*="${safeValue}"]`;
      } else {
        cssSelector += `[${safeAttr}="${value}"]`;
      }
    }

    return cssSelector || element.tagName;
  } catch (err) {
    // fallback
    const tagName = element.tagName || '*';
    const highlightIndex = element.highlightIndex;
    return `${tagName}[highlight_index='${highlightIndex}']`;
  }
}

// ==========================================================
// 2) Native "getLocateElement" function to find the element
//    directly in the DOM (without Puppeteer/Playwright).
// ==========================================================
/**
 * Locates a DOM element in the current page/extension context, 
 * even if it’s inside an iframe. We walk up the element's 
 * "parent" chain to see if we have an iframe ancestor, then 
 * query inside that frame's contentDocument.
 *
 * @param {Object} element - The DOM node object with { parent, tag_name, xpath, attributes, highlightIndex, ... }
 * @param {Document} doc - The root Document to start from (usually window.document).
 * @returns {HTMLElement|null}
 */
function getLocateElement(elementData, doc = document) {
  const elementSelector = enhancedCssSelectorForElement(elementData)
  let elHandle = doc.querySelector(elementSelector);
  if (elHandle) {
    elHandle.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return elHandle;
  }

  // recursively loop through the parents and if a parent has a shadowRoot, call getLocateElement on it.
  // find the first shadowRoot parent and use that for the query.

  let shadowRootParent = elementData;
  while (shadowRootParent.parent) {
    shadowRootParent = shadowRootParent.parent;
    if (shadowRootParent.shadowRoot) {
      break;
    }
  }

  if (shadowRootParent && shadowRootParent.shadowRoot) {
    console.log("Locating shadowRoot parent", shadowRootParent);
    const parentNode = getLocateElement(shadowRootParent);
    if (!parentNode) {
      return null;
    }
    if (parentNode.shadowRoot) {
      console.log("parentNode", parentNode);
      console.log("elementSelector", elementSelector);
      elHandle = parentNode.shadowRoot.querySelector(elementSelector);
    }
    if (!elHandle) {
      elHandle = parentNode.querySelector(elementSelector);
    }
    if (!elHandle) {
      return null;
    } else {
      elHandle.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return elHandle;
    }
  }

  let iframeParent = elementData;
  while (iframeParent.parent) {
    iframeParent = iframeParent.parent;
    if (iframeParent.tagName === "iframe") {
      break;
    }
  }

  if (iframeParent && iframeParent.tagName === "iframe") {
    const parentNode = getLocateElement(iframeParent);
    if (!parentNode) {
      return null;
    }
    elHandle = parentNode.contentDocument.querySelector(elementSelector);
    if (!elHandle) {
      return null;
    } else {
      elHandle.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return elHandle;
    }
  }
}

// Function to determine if a selector is XPath or CSS
function isXPath(selector) {
  return (
    selector.startsWith("/") ||
    selector.startsWith("./") ||
    selector.startsWith("(")
  );
}

function findElementBySelector(selector) {
  const result = document.evaluate(
    selector,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  );
  return result.singleNodeValue;
}

// Initialize cursor in the middle of the viewport when extension is activated
function initializeCursor() {
  // Only initialize cursor in the top frame
  if (window.top !== window.self) {
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const x = viewportWidth / 2;
  const y = viewportHeight / 2;

  updateCursor(x, y);
}

// Animate cursor movement to target position
async function animateCursorTo(targetX, targetY, duration = 500) {
  if (!cursorElement) {
    initializeCursor();
  }

  const startRect = cursorElement.getBoundingClientRect();
  const startX = startRect.left;
  const startY = startRect.top;
  const startTime = performance.now();

  return new Promise((resolve) => {
    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function for smooth movement
      const easeOutCubic = (progress) => 1 - Math.pow(1 - progress, 3);
      const easeProgress = easeOutCubic(progress);

      const currentX = startX + (targetX - startX) * easeProgress;
      const currentY = startY + (targetY - startY) * easeProgress;

      updateCursor(currentX, currentY);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(animate);
  });
}

// Update the click handler to use cursor animation
async function handleClick(elementData) {
  try {
    if (!elementData) {
      console.error("No element data provided");
      return false;
    }

    const element = getLocateElement(elementData);
    console.log("Clickable element:", element);
    if (!element) {
      console.warn(`Element not found with selector: ${elementData.xpath}`);
      return false;
    }

    // Get element center coordinates for visual feedback
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Highlight the element
    const originalOutline = element.style.outline;
    element.style.outline = "2px solid red";

    // Animate cursor to target position
    await animateCursorTo(x, y);

    // Show click animation
    showClickIndicator(x, y);
    // Try native click() if element supports it
    if (typeof element.click === 'function') {
      try {
        element.click();
        return; // Exit if native click is successful
      } catch (error) {
        console.log('Native click() failed:', error);
      }
    }

    // Trigger events after cursor reaches the target only if native click failed
    ["mousedown", "mouseup", "click"].forEach((eventType) => {
      element.dispatchEvent(
        new MouseEvent(eventType, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y
        })
      );
    });

    // Remove highlight after a delay
    setTimeout(() => {
      element.style.outline = originalOutline;
    }, 500);

    return true;
  } catch (error) {
    console.error("Error in click handler:", error);
    return false;
  }
}

// Add cleanup function
function cleanupExtensionMarkup() {
  try {
    // Remove the highlight container and all its contents
    const container = document.getElementById("playwright-highlight-container");
    if (container) {
      container.remove();
    }

    // Remove highlight attributes from elements
    const highlightedElements = document.querySelectorAll(
      '[browser-user-highlight-id^="playwright-highlight-"]'
    );
    highlightedElements.forEach((el) => {
      el.removeAttribute("browser-user-highlight-id");
    });
  } catch (e) {
    console.error("Failed to remove highlights:", e);
  }

  // Remove any highlight overlays
  const overlays = document.querySelectorAll(
    'div[style*="position: absolute"][style*="z-index: 999999"]'
  );
  overlays.forEach((overlay) => overlay.remove());

  // Remove any debug screenshot overlays
  const debugOverlays = document.querySelectorAll(
    'div[style*="position: fixed"][style*="z-index: 10000"]'
  );
  debugOverlays.forEach((overlay) => overlay.remove());

  // Remove any click indicators
  const indicators = document.querySelectorAll(
    'div[style*="position: fixed"][style*="border-radius: 50%"]'
  );
  indicators.forEach((indicator) => indicator.remove());
}

function createSelectorMap(elementTree) {
  function processNode(node) {
    if (node.type === "element") {
      // If this node is highlighted, store it
      if (typeof node.highlightIndex === "number") {
        interactiveElementsMap[node.highlightIndex] = node;
      }
      // Continue traversing children
      if (Array.isArray(node.children)) {
        node.children.forEach((child) => processNode(child));
      }
    }
    // Text nodes, or other node types, we do nothing special here
  }

  processNode(elementTree);
  return interactiveElementsMap;
}

function parseNode(nodeData, parent = null) {
  // Validate input
  if (!nodeData || typeof nodeData !== 'object') {
    return null;
  }

  try {
    // Handle text nodes
    if (nodeData.type === 'TEXT_NODE' || nodeData.type === 'text') {
      if (typeof nodeData.text !== 'string') {
        console.warn('Text node missing valid text content');
        return null;
      }
      return {
        type: 'text',
        text: nodeData.text.trim(), // Trim whitespace
        isVisible: Boolean(nodeData.isVisible),
        parent: parent,
      };
    }

    // Handle element nodes
    if (!nodeData.tagName) {
      return null;
    }

    const elementNode = {
      type: 'element',
      tagName: nodeData.tagName,
      xpath: nodeData.xpath || '',
      attributes: nodeData.attributes || {},
      isVisible: Boolean(nodeData.isVisible),
      isInteractive: Boolean(nodeData.isInteractive),
      isTopElement: Boolean(nodeData.isTopElement),
      highlightIndex: typeof nodeData.highlightIndex === 'number' ? nodeData.highlightIndex : null,
      shadowRoot: Boolean(nodeData.shadowRoot),
      children: [], // Initialize empty array
      parent: parent,
    };

    // Recursively parse children if they exist
    if (Array.isArray(nodeData.children)) {
      elementNode.children = nodeData.children
        .map(child => parseNode(child, elementNode)) // Use regular function call instead of this
        .filter(child => child !== null); // Filter out invalid children
    }

    return elementNode;

  } catch (error) {
    console.error('Error parsing node:', error);
    return null;
  }
}


// Function to get the list of interactive elements
function getInteractiveElementsList(rootNode) {
  const parsedNode = parseNode(rootNode);
  createSelectorMap(parsedNode);
  console.log("Interactive Elements List:", interactiveElementsMap);
  return parsedNode;
}



function hasParentWithHighlightIndex(node) {
  let current = node.parent;
  while (current) {
    if (typeof current.highlightIndex === "number") {
      // If it's an integer or numeric, we treat that as having a highlight
      return true;
    }
    current = current.parent;
  }
  return false;
}

function getAllTextTillNextClickableElement(node) {
  const textParts = [];

  function collectText(currentNode) {
    // If we hit a different element that is highlighted, stop recursion down that branch
    if (
      currentNode !== node &&
      currentNode.type === "element" &&
      typeof currentNode.highlightIndex === "number"
    ) {
      return;
    }

    // If it's a text node, collect its text
    if (currentNode.type === "text") {
      textParts.push(currentNode.text);
    }
    // If it's an element node, keep recursing into its children
    else if (currentNode.type === "element" && currentNode.children) {
      currentNode.children.forEach((child) => collectText(child));
    }
  }

  collectText(node);
  return textParts.join("\n").trim();
}

function clickableElementsToString(rootNode, includeAttributes = []) {
  const lines = [];

  function processNode(node) {
    if (node.type === "element") {
      // If this element is explicitly highlighted (i.e. has highlightIndex)
      if (typeof node.highlightIndex === "number") {
        // Build an attributes string (only for keys in includeAttributes)
        let attrStr = "";
        if (includeAttributes.length > 0) {
          const filteredAttrs = Object.entries(node.attributes)
            .filter(([key]) => includeAttributes.includes(key))
            .map(([key, value]) => `${key}="${value}"`)
            .join(" ");
          if (filteredAttrs.length > 0) {
            attrStr = " " + filteredAttrs; // prepend a space
          }
        }

        // Gather text under this node until another clickable element is found
        const innerText = getAllTextTillNextClickableElement(node);

        // e.g. "12[:]<button id="myBtn">Some text</button>"
        lines.push(
          `${node.highlightIndex}[:]<${node.tagName}${attrStr}>${innerText}</${node.tagName}>`
        );
      }

      // Regardless of highlight, process children to find more clickable elements or text
      if (node.children && node.children.length > 0) {
        node.children.forEach((child) => processNode(child));
      }
    } else if (node.type === "text") {
      // Only include this text if it doesn't live under a highlighted ancestor
      // (this matches the "if not node.has_parent_with_highlight_index()" in Python)
      // if (!hasParentWithHighlightIndex(node)) {
      // }
      lines.push(`_[:]${node.text}`);
    }
  }

  processNode(rootNode);
  return lines.join("\n");
}

// Add fill handler function
async function handleFill(elementData, value) {
  try {
    if (!elementData) {
      console.error("No element data provided");
      return false;
    }

    const element = getLocateElement(elementData);
    console.log("Filling element:", element);
    if (!element) {
      console.warn(`Element not found with selector: ${elementData.xpath}`);
      return false;
    }

    // Get element center coordinates for visual feedback
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Highlight the element
    const originalOutline = element.style.outline;
    element.style.outline = "2px solid blue";

    // Animate cursor to target position
    await animateCursorTo(x, y);

    // Show click indicator
    showClickIndicator(x, y, "#3399FF");

    // Focus the element
    element.focus();
    element.dispatchEvent(new Event("focus", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    // Clear existing value if it's an input or textarea
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      element.value = "";
    }

    // Type the value character by character
    for (const char of value) {
      // Create and dispatch keydown event
      const keydownEvent = new KeyboardEvent("keydown", {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      element.dispatchEvent(keydownEvent);

      // Create and dispatch keypress event
      const keypressEvent = new KeyboardEvent("keypress", {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      element.dispatchEvent(keypressEvent);

      // Append the character to the element's value
      element.value += char;

      // Dispatch input event after each character
      element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

      // Create and dispatch keyup event
      const keyupEvent = new KeyboardEvent("keyup", {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(keyupEvent);

      // Add slight delay between characters
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Dispatch change event after filling
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    // Remove highlight after a delay
    setTimeout(() => {
      element.style.outline = originalOutline;
    }, 500);

    return true;
  } catch (error) {
    console.error("Error in fill handler:", error);
    return false;
  }
}

// Function to check if document is ready for interaction
function isDocumentReady() {
  // Check if document is in complete or interactive state
  if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
    return false;
  }

  // Check if any iframes are still loading
  const iframes = document.getElementsByTagName('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument;
      if (iframeDoc && iframeDoc.readyState !== 'complete') {
        return false;
      }
    } catch (e) {
      // Cross-origin iframe, ignore
    }
  }

  // Check if any images are still loading
  const images = document.getElementsByTagName('img');
  for (const img of images) {
    if (!img.complete) {
      return false;
    }
  }

  // Check if any dynamic content is still loading (e.g., React, Vue, Angular)
  const loadingIndicators = document.querySelectorAll('[aria-busy="true"], [role="progressbar"]');
  if (loadingIndicators.length > 0) {
    return false;
  }

  return true;
}

// Update the message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === "INIT_CURSOR") {
      initializeCursor();
      sendResponse({ success: true });
    } else if (message.type === "CLEANUP_MARKUP") {
      cleanupExtensionMarkup();
      sendResponse({ success: true });
    } else if (message.type === "CHECK_DOCUMENT_READY") {
      sendResponse({ success: true, ready: isDocumentReady() });
    } else if (message.type === "PERFORM_CLICK") {
      console.log("Message.index:", message.index);
      console.log("Message.index parsed:", parseInt(message.index));
      console.log("interactiveElementsMap:", interactiveElementsMap);
      const elementData = interactiveElementsMap[parseInt(message.index)];
      console.log("elementData:", elementData);
      console.log("Attempting to click element:", {
        requestedIndex: message.index,
        foundElement: elementData,
      });
      if (!elementData) {
        sendResponse({
          success: false,
          error: `No element found with index: ${message.index}`,
        });
        return true;
      }

      handleClick(elementData)
        .then((success) => {
          sendResponse({ success });
        })
        .catch((error) => {
          console.error("Error performing click:", error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.type === "PERFORM_FILL") {
      const elementData = interactiveElementsMap[parseInt(message.index)];
      console.log("Attempting to fill element:", {
        requestedIndex: message.index,
        foundElement: elementData,
        value: message.value,
      });
      if (!elementData) {
        sendResponse({
          success: false,
          error: `No element found with index: ${message.index}`,
        });
        return true;
      }

      handleFill(elementData, message.value)
        .then((success) => {
          sendResponse({ success });
        })
        .catch((error) => {
          console.error("Error performing fill:", error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.type === "SEARCH_GOOGLE") {
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(
        message.query
      )}`;
      sendResponse({ success: true });
    } else if (message.type === "GO_TO_URL") {
      window.location.href = message.url;
      sendResponse({ success: true });
    } else if (message.type === "GO_BACK") {
      window.history.back();
      sendResponse({ success: true });
    } else if (message.type === "SCROLL_DOWN") {
      if (message.amount) {
        window.scrollBy(0, message.amount);
      } else {
        document.documentElement.scrollTop += window.innerHeight;
      }
      sendResponse({ success: true });
    } else if (message.type === "SCROLL_UP") {
      if (message.amount) {
        window.scrollBy(0, -message.amount);
      } else {
        document.documentElement.scrollTop -= window.innerHeight;
      }
      sendResponse({ success: true });
    } else if (message.type === "SEND_KEYS") {
      try {
        const activeElement = document.activeElement;
        if (
          activeElement &&
          (activeElement.tagName === "INPUT" ||
            activeElement.tagName === "TEXTAREA")
        ) {
          // For special keys like Enter, Backspace, etc.
          if (message.keys.includes("+") || message.keys.length > 1) {
            const event = new KeyboardEvent("keydown", {
              key: message.keys,
              code: message.keys,
              bubbles: true,
              cancelable: true,
              composed: true,
            });
            activeElement.dispatchEvent(event);
          } else {
            // For regular text input
            activeElement.value += message.keys;
            activeElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            activeElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          }
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error("Error sending keys:", error);
        sendResponse({ success: false, error: error.message });
      }
    } else if (message.type === "EXTRACT_CONTENT") {
      try {
        let content;
        if (message.format === "text") {
          content = document.body.innerText;
        } else if (message.format === "markdown") {
          // Simple HTML to Markdown conversion
          content = document.body.innerHTML
            .replace(/<h[1-6]>(.*?)<\/h[1-6]>/g, "# $1\n")
            .replace(/<p>(.*?)<\/p>/g, "$1\n")
            .replace(/<a href="(.*?)">(.*?)<\/a>/g, "[$2]($1)")
            .replace(/<strong>(.*?)<\/strong>/g, "**$1**")
            .replace(/<em>(.*?)<\/em>/g, "*$1*")
            .replace(/<.*?>/g, "");
        } else {
          content = document.body.innerHTML;
        }
        sendResponse({ success: true, content: content });
      } catch (error) {
        console.error("Error extracting content:", error);
        sendResponse({ success: false, error: error.message });
      }
    } else if (message.type === "GET_PAGE_MARKUP") {
      console.log("Starting page markup analysis...");

      // Clean up before getting markup
      cleanupExtensionMarkup();

      // Reset interactive elements tracking
      resetInteractiveElements();
      console.log("Reset interactive elements tracking");

      // Build the DOM tree and collect interactive elements
      try {
        doHighlightElements = message.highlightElements || false;
        let includeAttributes = [
          "title",
          "type",
          "name",
          "role",
          "tabindex",
          "aria-label",
          "placeholder",
          "value",
          "alt",
          "aria-expanded",
        ];
        const domTree = buildDomTree(document.body);
        console.log("DOM Tree:", domTree);
        const interactiveElements = getInteractiveElementsList(domTree);
        console.log(`Found ${interactiveElementsMap.length} interactive elements`);

        sendResponse({
          success: true,
          stringifiedInteractiveElements: clickableElementsToString(interactiveElements, includeAttributes),
        });
      } catch (error) {
        console.error("Error building interactive elements list:", error);
        sendResponse({
          success: false,
          error:
            "Failed to build interactive elements list: " + error.message,
        });
      }
    } else if (message.type === "DEBUG_SCREENSHOT") {
      // Handle debug screenshot display
      const debugOverlay = document.createElement("div");
      debugOverlay.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        background: rgba(0, 0, 0, 0.8);
        padding: 10px;
        border-radius: 5px;
        max-width: 300px;
      `;

      const img = document.createElement("img");
      img.src = message.imageUri;
      img.style.width = "100%";
      debugOverlay.appendChild(img);

      document.body.appendChild(debugOverlay);

      // Remove after 5 seconds
      setTimeout(() => {
        debugOverlay.remove();
      }, 5000);

      sendResponse({ success: true });
    }
  } catch (error) {
    console.error("Error in content script:", error);
    sendResponse({ success: false, error: error.message });
  }

  // Return true to indicate we'll send a response asynchronously
  return true;
});

// Create or update the cursor position
function updateCursor(x, y) {
  if (!cursorElement) {
    cursorElement = document.createElement("div");

    // Create the cursor pointer element
    const pointer = document.createElement("div");
    Object.assign(pointer.style, {
      width: "20px",
      height: "20px",
      position: "absolute",
      top: "0",
      left: "0",
      backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="%23FF5733"><path d="M7 2l12 11.2-5.8.5 3.3 7.3-2.2 1-3.2-7-4.1 4z"/></svg>')`,
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      pointerEvents: "none",
    });

    // Create the name label
    const label = document.createElement("div");
    Object.assign(label.style, {
      position: "absolute",
      left: "20px",
      top: "0",
      backgroundColor: "#FF5733",
      color: "white",
      padding: "2px 6px",
      borderRadius: "3px",
      fontSize: "12px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      userSelect: "none",
    });
    chrome.storage.local.get({ cursor_label: 'AI Assistant' }, (items) => {
      label.textContent = items.cursor_label;
    });

    cursorElement.appendChild(pointer);
    cursorElement.appendChild(label);

    // Style the container
    Object.assign(cursorElement.style, {
      position: "fixed",
      zIndex: "999998",
      pointerEvents: "none",
      transition: "transform 0.1s ease-out",
      left: "0",
      top: "0",
    });

    document.body.appendChild(cursorElement);
  }

  // Update cursor position with smooth transition
  cursorElement.style.transform = `translate(${x}px, ${y}px)`;
}

// Create and animate a visual click indicator
function showClickIndicator(x, y, color = "#FF5733") {
  const indicator = document.createElement("div");

  // Style the indicator
  Object.assign(indicator.style, {
    position: "fixed",
    left: `${x - 5}px`, // Center the 10px dot
    top: `${y - 5}px`,
    width: "10px",
    height: "10px",
    backgroundColor: color,
    borderRadius: "50%",
    pointerEvents: "none",
    zIndex: "999999",
    opacity: "0.8",
    transform: "scale(1)",
    transition: "all 0.5s ease-out",
  });

  document.body.appendChild(indicator);

  // Animate the indicator
  requestAnimationFrame(() => {
    indicator.style.transform = "scale(2)";
    indicator.style.opacity = "0";
  });

  // Remove the indicator after animation
  setTimeout(() => {
    indicator.remove();
  }, 500);
}
