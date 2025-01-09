// contentScript.js

// Keep track of the cursor element
let cursorElement = null;

// Add a global map to store interactive elements by index
let interactiveElementsMap = new Map();
let currentHighlightIndex = 0;
let doHighlightElements = true;

// Function to reset the interactive elements tracking
function resetInteractiveElements() {
  interactiveElementsMap.clear();
  currentHighlightIndex = 0;
}

// Function to get element by index
function getElementByIndex(index) {
  console.log("Getting element by index:", index);
  const elementData = interactiveElementsMap[index];
  console.log("Interactive elements map:", elementData);
  return elementData ? findElementBySelector(elementData.xpath) : null;
}

let highlightIndex = 0; // Reset highlight index

function highlightElement(element, index, parentIframe = null) {
  // Create or get highlight container
  let container = document.getElementById("playwright-highlight-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "playwright-highlight-container";
    container.style.position = "fixed";
    container.style.pointerEvents = "none";
    container.style.top = "0";
    container.style.left = "0";
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.zIndex = "2147483647"; // Maximum z-index value
    document.documentElement.appendChild(container);
  }

  // Generate a color based on the index
  const colors = [
    "#FF0000",
    "#00FF00",
    "#0000FF",
    "#FFA500",
    "#800080",
    "#008080",
    "#FF69B4",
    "#4B0082",
    "#FF4500",
    "#2E8B57",
    "#DC143C",
    "#4682B4",
  ];
  const colorIndex = index % colors.length;
  const baseColor = colors[colorIndex];
  const backgroundColor = `${baseColor}1A`; // 10% opacity version of the color

  // Create highlight overlay
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.border = `2px solid ${baseColor}`;
  overlay.style.backgroundColor = backgroundColor;
  overlay.style.pointerEvents = "none";
  overlay.style.boxSizing = "border-box";

  // Position overlay based on element
  const rect = element.getBoundingClientRect();
  let top = rect.top;
  let left = rect.left;

  // Adjust position if element is inside an iframe
  if (parentIframe) {
    const iframeRect = parentIframe.getBoundingClientRect();
    top += iframeRect.top;
    left += iframeRect.left;
  }

  overlay.style.top = `${top}px`;
  overlay.style.left = `${left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;

  // Create label
  const label = document.createElement("div");
  label.className = "playwright-highlight-label";
  label.style.position = "absolute";
  label.style.background = baseColor;
  label.style.color = "white";
  label.style.padding = "1px 4px";
  label.style.borderRadius = "4px";
  label.style.fontSize = `${Math.min(12, Math.max(8, rect.height / 2))}px`; // Responsive font size
  label.textContent = index;

  // Calculate label position
  const labelWidth = 20; // Approximate width
  const labelHeight = 16; // Approximate height

  // Default position (top-right corner inside the box)
  let labelTop = top + 2;
  let labelLeft = left + rect.width - labelWidth - 2;

  // Adjust if box is too small
  if (rect.width < labelWidth + 4 || rect.height < labelHeight + 4) {
    // Position outside the box if it's too small
    labelTop = top - labelHeight - 2;
    labelLeft = left + rect.width - labelWidth;
  }

  // Ensure label stays within viewport
  if (labelTop < 0) labelTop = top + 2;
  if (labelLeft < 0) labelLeft = left + 2;
  if (labelLeft + labelWidth > window.innerWidth) {
    labelLeft = left + rect.width - labelWidth - 2;
  }

  label.style.top = `${labelTop}px`;
  label.style.left = `${labelLeft}px`;

  // Add to container
  container.appendChild(overlay);
  container.appendChild(label);

  // Store reference for cleanup
  element.setAttribute(
    "browser-user-highlight-id",
    `playwright-highlight-${index}`
  );

  return index + 1;
}

// Helper function to generate XPath as a tree
function getXPathTree(element, stopAtBoundary = true) {
  const segments = [];
  let currentElement = element;

  while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
    // Stop if we hit a shadow root or iframe
    if (
      stopAtBoundary &&
      (currentElement.parentNode instanceof ShadowRoot ||
        currentElement.parentNode instanceof HTMLIFrameElement)
    ) {
      break;
    }

    let index = 0;
    let sibling = currentElement.previousSibling;
    while (sibling) {
      if (
        sibling.nodeType === Node.ELEMENT_NODE &&
        sibling.nodeName === currentElement.nodeName
      ) {
        index++;
      }
      sibling = sibling.previousSibling;
    }

    const tagName = currentElement.nodeName.toLowerCase();
    const xpathIndex = index > 0 ? `[${index + 1}]` : "";
    segments.unshift(`${tagName}${xpathIndex}`);

    currentElement = currentElement.parentNode;
  }

  return segments.join("/");
}

// Helper function to check if element is accepted
function isElementAccepted(element) {
  const leafElementDenyList = new Set([
    "svg",
    "script",
    "style",
    "link",
    "meta",
  ]);
  return !leafElementDenyList.has(element.tagName.toLowerCase());
}

// Helper function to check if element is interactive
function isInteractiveElement(element) {
  // Base interactive elements and roles
  const interactiveElements = new Set([
    "a",
    "button",
    "details",
    "embed",
    "input",
    "label",
    "menu",
    "menuitem",
    "object",
    "select",
    "textarea",
    "summary",
  ]);

  const interactiveRoles = new Set([
    "button",
    "menu",
    "menuitem",
    "link",
    "checkbox",
    "radio",
    "slider",
    "tab",
    "tabpanel",
    "textbox",
    "combobox",
    "grid",
    "listbox",
    "option",
    "progressbar",
    "scrollbar",
    "searchbox",
    "switch",
    "tree",
    "treeitem",
    "spinbutton",
    "tooltip",
    "a-button-inner",
    "a-dropdown-button",
    "click",
    "menuitemcheckbox",
    "menuitemradio",
    "a-button-text",
    "button-text",
    "button-icon",
    "button-icon-only",
    "button-text-icon-only",
    "dropdown",
    "combobox",
  ]);

  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute("role");
  const ariaRole = element.getAttribute("aria-role");
  const tabIndex = element.getAttribute("tabindex");

  // Basic role/attribute checks
  const hasInteractiveRole =
    interactiveElements.has(tagName) ||
    interactiveRoles.has(role) ||
    interactiveRoles.has(ariaRole) ||
    (tabIndex !== null && tabIndex !== "-1") ||
    element.getAttribute("data-action") === "a-dropdown-select" ||
    element.getAttribute("data-action") === "a-dropdown-button";

  if (hasInteractiveRole) return true;

  // Get computed style
  const style = window.getComputedStyle(element);

  // Check if element has click-like styling
  // const hasClickStyling = style.cursor === 'pointer' ||
  //     element.style.cursor === 'pointer' ||
  //     style.pointerEvents !== 'none';

  // Check for event listeners
  const hasClickHandler =
    element.onclick !== null ||
    element.getAttribute("onclick") !== null ||
    element.hasAttribute("ng-click") ||
    element.hasAttribute("@click") ||
    element.hasAttribute("v-on:click");

  // Helper function to safely get event listeners
  function getEventListeners(el) {
    try {
      // Try to get listeners using Chrome DevTools API
      return window.getEventListeners?.(el) || {};
    } catch (e) {
      // Fallback: check for common event properties
      const listeners = {};

      // List of common event types to check
      const eventTypes = [
        "click",
        "mousedown",
        "mouseup",
        "touchstart",
        "touchend",
        "keydown",
        "keyup",
        "focus",
        "blur",
      ];

      for (const type of eventTypes) {
        const handler = el[`on${type}`];
        if (handler) {
          listeners[type] = [
            {
              listener: handler,
              useCapture: false,
            },
          ];
        }
      }

      return listeners;
    }
  }

  // Check for click-related events on the element itself
  const listeners = getEventListeners(element);
  const hasClickListeners =
    listeners &&
    (listeners.click?.length > 0 ||
      listeners.mousedown?.length > 0 ||
      listeners.mouseup?.length > 0 ||
      listeners.touchstart?.length > 0 ||
      listeners.touchend?.length > 0);

  // Check for ARIA properties that suggest interactivity
  const hasAriaProps =
    element.hasAttribute("aria-expanded") ||
    element.hasAttribute("aria-pressed") ||
    element.hasAttribute("aria-selected") ||
    element.hasAttribute("aria-checked");

  // Check for form-related functionality
  const isFormRelated =
    element.form !== undefined ||
    element.hasAttribute("contenteditable") ||
    style.userSelect !== "none";

  // Check if element is draggable
  const isDraggable =
    element.draggable || element.getAttribute("draggable") === "true";

  return (
    hasAriaProps ||
    // hasClickStyling ||
    hasClickHandler ||
    hasClickListeners ||
    // isFormRelated ||
    isDraggable
  );
}

// Helper function to check if element is visible
function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  return (
    element.offsetWidth > 0 &&
    element.offsetHeight > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

// Helper function to check if element is the top element at its position
function isTopElement(element) {
  // Find the correct document context and root element
  let doc = element.ownerDocument;

  // If we're in an iframe, elements are considered top by default
  if (doc !== window.document) {
    return true;
  }

  // For shadow DOM, we need to check within its own root context
  const shadowRoot = element.getRootNode();
  if (shadowRoot instanceof ShadowRoot) {
    const rect = element.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };

    try {
      // Use shadow root's elementFromPoint to check within shadow DOM context
      const topEl = shadowRoot.elementFromPoint(point.x, point.y);
      if (!topEl) return false;

      // Check if the element or any of its parents match our target element
      let current = topEl;
      while (current && current !== shadowRoot) {
        if (current === element) return true;
        current = current.parentElement;
      }
      return false;
    } catch (e) {
      return true; // If we can't determine, consider it visible
    }
  }

  // Regular DOM elements
  const rect = element.getBoundingClientRect();
  const point = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };

  try {
    const topEl = document.elementFromPoint(point.x, point.y);
    if (!topEl) return false;

    let current = topEl;
    while (current && current !== document.documentElement) {
      if (current === element) return true;
      current = current.parentElement;
    }
    return false;
  } catch (e) {
    return true;
  }
}

// Helper function to check if text node is visible
function isTextNodeVisible(textNode) {
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const rect = range.getBoundingClientRect();

  return (
    rect.width !== 0 &&
    rect.height !== 0 &&
    rect.top >= 0 &&
    rect.top <= window.innerHeight &&
    textNode.parentElement?.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
    })
  );
}

// Function to traverse the DOM and create nested JSON
async function buildDomTree(node, parentIframe = null){
  if (!node) return null;

  // Special case for text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    const textContent = node.textContent.trim();
    if (textContent && isTextNodeVisible(node)) {
      return {
        type: "TEXT_NODE",
        text: textContent,
        isVisible: true,
      };
    }
    return null;
  }

  // Check if element is accepted
  if (node.nodeType === Node.ELEMENT_NODE && !isElementAccepted(node)) {
    return null;
  }

  const nodeData = {
    tagName: node.tagName ? node.tagName.toLowerCase() : null,
    attributes: {},
    xpath:
      node.nodeType === Node.ELEMENT_NODE ? getXPathTree(node, true) : null,
    children: [],
  };

  // Copy all attributes if the node is an element
  if (node.nodeType === Node.ELEMENT_NODE && node.attributes) {
    // Use getAttributeNames() instead of directly iterating attributes
    const attributeNames = node.getAttributeNames?.() || [];
    for (const name of attributeNames) {
      nodeData.attributes[name] = node.getAttribute(name);
    }
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const isInteractive = isInteractiveElement(node);
    const isVisible = isElementVisible(node);
    const isTop = isTopElement(node);

    nodeData.isInteractive = isInteractive;
    nodeData.isVisible = isVisible;
    nodeData.isTopElement = isTop;

    // Highlight if element meets all criteria and highlighting is enabled
    if (isInteractive && isVisible && isTop) {
      nodeData.highlightIndex = highlightIndex++;
      // Check debug mode before highlighting
      const { debug_mode } = await chrome.storage.local.get({ debug_mode: false });
      if (debug_mode && doHighlightElements) {
        highlightElement(node, nodeData.highlightIndex, parentIframe);
      }
    }
  }

  // Only add iframeContext if we're inside an iframe
  // if (parentIframe) {
  //     nodeData.iframeContext = `iframe[src="${parentIframe.src || ''}"]`;
  // }

  // Only add shadowRoot field if it exists
  if (node.shadowRoot) {
    nodeData.shadowRoot = true;
    // Handle shadow DOM
    const shadowChildren = await Promise.all(
      Array.from(node.shadowRoot.childNodes).map(child => 
        buildDomTree(child, parentIframe)
      )
    );
    nodeData.children.push(...shadowChildren.filter(Boolean));
  }

  // Handle iframes
  if (node.tagName === "IFRAME") {
    try {
      const iframeDoc = node.contentDocument || node.contentWindow.document;
      if (iframeDoc) {
        const iframeChildren = await Promise.all(
          Array.from(iframeDoc.body.childNodes).map(child =>
            buildDomTree(child, node)
          )
        );
        nodeData.children.push(...iframeChildren.filter(Boolean));
      }
    } catch (e) {
      console.warn("Unable to access iframe:", node);
    }
  } else {
    // Handle regular children
    const children = await Promise.all(
      Array.from(node.childNodes).map(child =>
        buildDomTree(child, parentIframe)
      )
    );
    nodeData.children.push(...children.filter(Boolean));
  }

  return nodeData;
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
async function handleClick(selector) {
  try {
    if (!selector) {
      console.error("No selector provided");
      return false;
    }

    const element = findElementBySelector(selector);
    if (!element) {
      console.warn(`Element not found with selector: ${selector}`);
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

    // Trigger events after cursor reaches the target
    ["mousedown", "mouseup", "click"].forEach((eventType) => {
      element.dispatchEvent(
        new MouseEvent(eventType, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
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
  // Remove cursor element
  if (cursorElement) {
    cursorElement.remove();
    cursorElement = null;
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
      console.log("Processing node:", node);
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
    console.warn('Invalid nodeData provided to parseNode');
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
        isVisible: Boolean(nodeData.isVisible)
      };
    }

    // Handle element nodes
    if (!nodeData.tagName) {
      return null;
    }

    const elementNode = {
      type: 'element',
      tagName: nodeData.tagName.toLowerCase(), // Normalize tag names
      xpath: nodeData.xpath || '',
      attributes: nodeData.attributes || {},
      isVisible: Boolean(nodeData.isVisible),
      isInteractive: Boolean(nodeData.isInteractive),
      isTopElement: Boolean(nodeData.isTopElement),
      highlightIndex: typeof nodeData.highlightIndex === 'number' ? nodeData.highlightIndex : null,
      shadowRoot: Boolean(nodeData.shadowRoot),
      children: [], // Initialize empty array
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
  
  // const list = Array.from(interactiveElementsMap.values());
  console.log("Complete Interactive Elements List:", interactiveElementsMap);
  return parsedNode;
}

// Add fill handler function
async function handleFill(selector, value) {
  try {
    if (!selector || !value) {
      console.error("No selector or value provided");
      return false;
    }

    const element = findElementBySelector(selector);
    if (!element) {
      console.warn(`Element not found with selector: ${selector}`);
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

    // Clear existing value if it's an input or textarea
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      element.value = "";
    }

    // Type the value character by character
    for (const char of value) {
      element.value = element.value + char;
      // Dispatch input event after each character
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50)); // Add slight delay between characters
    }

    // Dispatch change event after filling
    element.dispatchEvent(new Event("change", { bubbles: true }));

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

      handleClick(elementData.xpath)
        .then((success) => {
          sendResponse({ success });
        })
        .catch((error) => {
          console.error("Error performing click:", error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.type === "PERFORM_FILL") {
      console.log("Message.index:", message.index);
      console.log("Message.index parsed:", parseInt(message.index));
      console.log("interactiveElementsMap:", interactiveElementsMap);
      const elementData = interactiveElementsMap[parseInt(message.index)];
      console.log("elementData:", elementData);
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

      handleFill(elementData.xpath, message.value)
        .then((success) => {
          sendResponse({ success });
        })
        .catch((error) => {
          console.error("Error performing fill:", error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.type === "PERFORM_FILL_AND_SUBMIT") {
      const elementData = interactiveElementsMap[parseInt(message.index)];
      console.log("Attempting to fill and submit element:", {
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

      // First fill the element
      handleFill(elementData.xpath, message.value)
        .then(async (success) => {
          if (success) {
            // After filling, send Enter key
            const element = findElementBySelector(elementData.xpath);
            if (element) {
              element.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                bubbles: true,
                cancelable: true
              }));
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: "Failed to fill element" });
          }
        })
        .catch((error) => {
          console.error("Error performing fill and submit:", error);
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
            activeElement.dispatchEvent(new Event("input", { bubbles: true }));
            activeElement.dispatchEvent(new Event("change", { bubbles: true }));
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
        sendResponse({ success: true, content });
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
      buildDomTree(document.body)
        .then((domTree) => {
          console.log("DOM Tree:", domTree);
          const interactiveElements = getInteractiveElementsList(domTree);
          console.log(
            `Found interactive elements`
          );

          sendResponse({
            success: true,
            interactiveElements,
          });
        })
        .catch((error) => {
          console.error("Error building interactive elements list:", error);
          sendResponse({
            success: false,
            error:
              "Failed to build interactive elements list: " + error.message,
          });
        });
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
