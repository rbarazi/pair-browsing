// contentScript.js

// Keep track of the cursor element
let cursorElement = null;

// Add a global map to store interactive elements by index
let interactiveElementsMap = new Map();
let currentHighlightIndex = 0;

// Function to reset the interactive elements tracking
function resetInteractiveElements() {
  interactiveElementsMap.clear();
  currentHighlightIndex = 0;
}

// Function to get element by index
function getElementByIndex(index) {
  const elementData = interactiveElementsMap.get(index);
  return elementData ? findElementBySelector(elementData.xpath) : null;
}

// Helper function to check if element is the topmost at its position
function isTopElement(el) {
    const doc = el.ownerDocument;

    // If we're in an iframe, elements are considered top by default
    if (doc !== window.document) {
        return true;
    }

    // For shadow DOM, check within its own root context
    const shadowRoot = el.getRootNode();
    if (shadowRoot instanceof ShadowRoot) {
        const rect = el.getBoundingClientRect();
        const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

        try {
            const topEl = shadowRoot.elementFromPoint(point.x, point.y);
            if (!topEl) return false;

            let current = topEl;
            while (current && current !== shadowRoot) {
                if (current === el) return true;
                current = current.parentElement;
            }
            return false;
        } catch (e) {
            return true;
        }
    }

    // Regular DOM elements
    const rect = el.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

    try {
        const topEl = document.elementFromPoint(point.x, point.y);
        if (!topEl) return false;

        let current = topEl;
        while (current && current !== document.documentElement) {
            if (current === el) return true;
            current = current.parentElement;
        }
        return false;
    } catch (e) {
        return true;
    }
}

// Add the buildDomTree function
/**
 * buildDomTree - Merged "Best of Both Worlds" Implementation
 *
 * Traverses the DOM (including shadow roots & iframes if desired),
 * captures key info (attributes, XPath, visibility, interactivity),
 * optionally highlights elements, and sets up a MutationObserver
 * to maintain the in-memory DOM tree for subsequent changes.
 *
 * @param {Node} rootElement - The starting point of the DOM (often document or document.body).
 * @param {Object} options
 *    @param {boolean} [doHighlightElements=false] - Whether to visually highlight elements via overlays.
 *    @param {boolean} [includeShadowRoots=true]   - Traverse shadow DOM trees?
 *    @param {boolean} [includeIFrames=true]       - Traverse iframes?
 *    @param {boolean} [includeTextNodes=true]     - Include text nodes in the output data?
 *    @param {boolean} [observeMutations=true]     - Observe DOM changes using a MutationObserver?
 * @returns {Promise<Object>} A nested JSON-like structure representing the DOM.
 */
async function buildDomTree(rootElement, options = {}) {
  // Merge defaults
  const {
    doHighlightElements = false,
    includeShadowRoots = true,
    includeIFrames = true,
    includeTextNodes = true,
    observeMutations = true,
  } = options;

  let highlightIndex = 0;

  // --------------------------------------------------------------------------
  //  1. HELPER FUNCTIONS
  // --------------------------------------------------------------------------

  /**
   * getXPathTree - Improved version that tries to use ID-based selector
   * if the element or any ancestor has a unique ID. Otherwise, it falls
   * back to a sibling-index path all the way to the root.
   */
  function getXPathTree(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    // Build path segments for each shadow root boundary
    const pathSegments = [];
    let current = node;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
        const root = current.getRootNode();
        
        // Build path segment up to the current root
        let segment = "";
        let segmentNode = current;
        
        while (segmentNode && segmentNode.nodeType === Node.ELEMENT_NODE && 
               segmentNode !== root && 
               !(root instanceof ShadowRoot && segmentNode === root.host)) {
            let index = 0;
            let sibling = segmentNode.previousSibling;
            
            while (sibling) {
                if (sibling.nodeType === Node.ELEMENT_NODE && 
                    sibling.nodeName === segmentNode.nodeName) {
                    index++;
                }
                sibling = sibling.previousSibling;
            }

            const tagName = segmentNode.nodeName.toLowerCase();
            // Only use // for custom elements that aren't at a shadow boundary
            const separator = tagName.includes('-') && !(root instanceof ShadowRoot && segmentNode === current) ? '//' : '/';
            const pathIndex = index ? `[${index + 1}]` : "";
            segment = `${separator}${tagName}${pathIndex}${segment}`;
            
            segmentNode = segmentNode.parentNode;
        }

        if (segment) {
            // Ensure segment starts with / if it's not a custom element path
            if (!segment.startsWith('/') && !segment.startsWith('//')) {
                segment = '/' + segment;
            }
            pathSegments.unshift(segment);
        }

        // If we're in a shadow root, move to the host
        if (root instanceof ShadowRoot) {
            current = root.host;
            pathSegments.unshift("::shadow");
        } else {
            current = current.parentNode;
        }
    }

    // Combine all segments and clean up the path
    return cleanXPath(pathSegments.join(''));
  }

  /**
   * isInteractiveElement - Checks if an element should be considered "interactive."
   * Extends standard clickable tags (a, button, etc.) with ARIA roles, tabIndex, and
   * inline event attributes (onmousedown, onclick, etc.).
   */
  function isInteractiveElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    
    // Base interactive elements and roles
    const interactiveElements = new Set([
        'a', 'button', 'details', 'embed', 'input', 'label',
        'menu', 'menuitem', 'object', 'select', 'textarea', 'summary'
    ]);

    const interactiveRoles = new Set([
        'button', 'menu', 'menuitem', 'link', 'checkbox', 'radio',
        'slider', 'tab', 'tabpanel', 'textbox', 'combobox', 'grid',
        'listbox', 'option', 'progressbar', 'scrollbar', 'searchbox',
        'switch', 'tree', 'treeitem', 'spinbutton', 'tooltip', 'a-button-inner', 
        'a-dropdown-button', 'click', 'menuitemcheckbox', 'menuitemradio', 
        'a-button-text', 'button-text', 'button-icon', 'button-icon-only', 
        'button-text-icon-only', 'dropdown', 'combobox'
    ]);

    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    const ariaRole = element.getAttribute('aria-role');
    const tabIndex = element.getAttribute('tabindex');

    // Basic role/attribute checks
    const hasInteractiveRole = interactiveElements.has(tagName) ||
        interactiveRoles.has(role) ||
        interactiveRoles.has(ariaRole) ||
        (tabIndex !== null && tabIndex !== '-1') ||
        element.getAttribute('data-action') === 'a-dropdown-select' ||
        element.getAttribute('data-action') === 'a-dropdown-button';

    if (hasInteractiveRole) return true;

    // Check for event listeners
    const hasClickHandler = element.onclick !== null ||
        element.getAttribute('onclick') !== null ||
        element.hasAttribute('ng-click') ||
        element.hasAttribute('@click') ||
        element.hasAttribute('v-on:click');

    // Helper function to safely get event listeners
    function getEventListeners(el) {
        try {
            return window.getEventListeners?.(el) || {};
        } catch (e) {
            const listeners = {};
            const eventTypes = [
                'click', 'mousedown', 'mouseup',
                'touchstart', 'touchend',
                'keydown', 'keyup', 'focus', 'blur'
            ];

            for (const type of eventTypes) {
                const handler = el[`on${type}`];
                if (handler) {
                    listeners[type] = [{
                        listener: handler,
                        useCapture: false
                    }];
                }
            }
            return listeners;
        }
    }

    // Check for click-related events
    const listeners = getEventListeners(element);
    const hasClickListeners = listeners && (
        listeners.click?.length > 0 ||
        listeners.mousedown?.length > 0 ||
        listeners.mouseup?.length > 0 ||
        listeners.touchstart?.length > 0 ||
        listeners.touchend?.length > 0
    );

    // Check for ARIA properties
    const hasAriaProps = element.hasAttribute('aria-expanded') ||
        element.hasAttribute('aria-pressed') ||
        element.hasAttribute('aria-selected') ||
        element.hasAttribute('aria-checked');

    // Check if element is draggable
    const isDraggable = element.draggable ||
        element.getAttribute('draggable') === 'true';

    return hasAriaProps ||
        hasClickHandler ||
        hasClickListeners ||
        isDraggable;
  }

  /**
   * highlightElement - Creates a semi-transparent overlay around
   * an element's bounding box for debugging/visualization.
   */
  function highlightElement(el, label) {
    try {
      const rect = el.getBoundingClientRect();
      // If the element is completely offscreen or size = 0, skip highlighting
      if (rect.width === 0 && rect.height === 0) return;

      const overlay = document.createElement("div");
      overlay.style.position = "absolute";
      overlay.style.top = rect.top + window.scrollY + "px";
      overlay.style.left = rect.left + window.scrollX + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";
      overlay.style.pointerEvents = "none";
      overlay.style.border = "2px solid red";
      overlay.style.backgroundColor = "rgba(255, 0, 0, 0.3)";
      overlay.style.zIndex = 999999;

      // Label overlay
      overlay.style.color = "white";
      overlay.style.fontSize = "12px";
      overlay.style.fontFamily = "monospace";
      overlay.style.padding = "2px";
      overlay.textContent = label;

      document.body.appendChild(overlay);
    } catch (e) {
      console.warn("Highlight failed on element:", el, e);
    }
  }

  /**
   * isElementVisible - Checks CSS-based visibility (display, visibility, opacity) AND
   * ensures nonzero offsets, so we skip elements that are effectively hidden.
   */
  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    
    const style = window.getComputedStyle(element);
    const isStyleVisible = style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        parseFloat(style.opacity) > 0 &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0;

    if (!isStyleVisible) return false;

    return true;
  }

  /**
   * findNodeByXPath - Locates a node in our JSON-like domTree by matching its XPath.
   * Used by the MutationObserver to update existing nodes when changes occur.
   */
  function findNodeByXPath(tree, xpath) {
    if (!tree) return null;
    // Compare if the node's xpath property matches
    if (tree.xpath === xpath) {
      return tree;
    }
    // Recursively check children
    if (tree.children) {
      for (const child of tree.children) {
        const found = findNodeByXPath(child, xpath);
        if (found) return found;
      }
    }
    // Check shadowRoot subtrees
    if (tree.shadowRoot) {
      const foundShadow = findNodeByXPath(tree.shadowRoot, xpath);
      if (foundShadow) return foundShadow;
    }
    // Check iframe subtrees
    if (tree.iframe) {
      const foundIframe = findNodeByXPath(tree.iframe, xpath);
      if (foundIframe) return foundIframe;
    }
    return null;
  }

  // --------------------------------------------------------------------------
  //  2. RECURSIVE TRAVERSAL FUNCTION
  // --------------------------------------------------------------------------

  async function traverse(node, parentIframe = null) {
    if (!node) return null;

    // Handle text nodes
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

    // ELEMENT_NODE
    if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;

        // Filter out some tags
        const ignoredTags = ["script", "style", "link", "meta", "svg"];
        if (ignoredTags.includes(el.tagName.toLowerCase())) {
            return null;
        }

        // Check element properties
        const isVisible = isElementVisible(el);
        const isInteractive = isInteractiveElement(el);
        const isTop = isTopElement(el); // Separate check for top element

        // Create node data with proper XPath
        const nodeData = {
            tagName: el.tagName.toLowerCase(),
            xpath: getXPathTree(el),
            text: el.textContent?.trim().substring(0, 100) || '',
            attributes: {},
            isCustomElement: el.tagName.includes('-'),
            hasShadowRoot: !!el.shadowRoot,
            isInteractive,
            isVisible,
            isTopElement: isTop
        };

        // Gather all attributes
        const attributeNames = el.getAttributeNames?.() || [];
        for (const name of attributeNames) {
            nodeData.attributes[name] = el.getAttribute(name);
        }

        // If element is interactive, visible, and topmost, add to map
        if (isInteractive && isVisible && isTop) {
            interactiveElementsMap.set(currentHighlightIndex, nodeData);
            
            if (doHighlightElements) {
                highlightElement(el, currentHighlightIndex, parentIframe);
            }

            currentHighlightIndex++;
        }

        // Process children
        const children = [];
        
        // Process regular children
        for (const child of el.childNodes) {
            const childData = await traverse(child, parentIframe);
            if (childData) {
                children.push(childData);
            }
        }

        // Process shadow DOM
        if (el.shadowRoot && includeShadowRoots) {
            const shadowChildren = [];
            for (const shadowChild of el.shadowRoot.childNodes) {
                const shadowChildData = await traverse(shadowChild, parentIframe);
                if (shadowChildData) {
                    shadowChildren.push(shadowChildData);
                }
            }
            if (shadowChildren.length > 0) {
                children.push({
                    type: 'shadowRoot',
                    children: shadowChildren
                });
            }
        }

        nodeData.children = children;
        return nodeData;
    }

    return null;
  }

  // Helper function to check if text node is visible
  function isTextNodeVisible(textNode) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();

    return rect.width !== 0 &&
        rect.height !== 0 &&
        rect.top >= 0 &&
        rect.top <= window.innerHeight &&
        textNode.parentElement?.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true
        });
  }

  // --------------------------------------------------------------------------
  //  3. INITIAL TRAVERSAL
  // --------------------------------------------------------------------------
  const domTree = await traverse(rootElement);

  // --------------------------------------------------------------------------
  //  4. MUTATION OBSERVER - If observeMutations is enabled
  // --------------------------------------------------------------------------
  let observer = null;
  if (observeMutations) {
    observer = new MutationObserver(async (mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          // Added Nodes
          for (const addedNode of mutation.addedNodes) {
            const addedNodeData = await traverse(addedNode);
            if (addedNodeData) {
              // Try to attach it under the parent's node in our domTree
              const parentXPath = getXPathTree(mutation.target);
              const parentNodeInTree = findNodeByXPath(domTree, parentXPath);
              if (parentNodeInTree && parentNodeInTree.children) {
                parentNodeInTree.children.push(addedNodeData);
              }
            }
          }
          // Removed Nodes (optional): you can find & remove them similarly
        } else if (mutation.type === "attributes") {
          // An attribute changed
          const element = mutation.target;
          if (element.nodeType === Node.ELEMENT_NODE) {
            const elementXPath = getXPathTree(element);
            const domNode = findNodeByXPath(domTree, elementXPath);
            if (domNode) {
              // Update changed attribute or remove if null
              const attrName = mutation.attributeName;
              const attrValue = element.getAttribute(attrName);
              if (attrValue !== null) {
                domNode.attributes[attrName] = attrValue;
              } else {
                delete domNode.attributes[attrName];
              }

              // Possibly update isInteractive & isVisible
              domNode.isInteractive = isInteractiveElement(element);
              domNode.isVisible = isElementVisible(element);
            }
          }
        }
        // characterData or subtree changes if needed
      }
    });

    observer.observe(rootElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }

  // Return both the tree and (optionally) the observer
  return domTree;
}

// Function to determine if a selector is XPath or CSS
function isXPath(selector) {
  return selector.startsWith('/') || selector.startsWith('./') || selector.startsWith('(');
}

// Function to find element by either XPath or CSS selector
function findElementBySelector(selector) {
    if (isXPath(selector)) {
        // Handle Shadow DOM in XPath
        if (selector.includes('::shadow')) {
            const parts = selector.split('::shadow');
            let currentElement = document;
            
            for (let i = 0; i < parts.length; i++) {
                let part = parts[i].trim();
                if (!part) continue;

                try {
                    if (currentElement instanceof DocumentFragment) {
                        // For shadow roots, we need to traverse manually
                        const pathParts = part.split('/').filter(p => p);
                        let context = currentElement;

                        for (const pathPart of pathParts) {
                            if (!context) break;

                            // For custom elements (containing hyphen), use deep query
                            if (pathPart.includes('-')) {
                                const elements = Array.from(context.querySelectorAll(pathPart));
                                context = elements[0] || null;
                                continue;
                            }

                            // Handle element with index (e.g., div[2])
                            const [tagName, indexStr] = pathPart.split('[');
                            const index = indexStr ? parseInt(indexStr.replace(']', '')) - 1 : 0;

                            // First try direct children
                            let elements = Array.from(context.children).filter(el => 
                                el.tagName.toLowerCase() === tagName.toLowerCase()
                            );

                            // If not found in direct children, try deeper
                            if (!elements.length) {
                                elements = Array.from(context.getElementsByTagName(tagName));
                            }

                            context = elements[index] || null;

                            if (!context) {
                                console.warn(`Could not find element ${tagName} at index ${index} in`, context);
                                break;
                            }
                        }
                        currentElement = context;
                    } else {
                        // For regular DOM, use document.evaluate
                        if (!part.startsWith('/')) {
                            part = '/' + part;
                        }
                        const result = document.evaluate(
                            part,
                            currentElement,
                            null,
                            XPathResult.FIRST_ORDERED_NODE_TYPE,
                            null
                        );
                        currentElement = result.singleNodeValue;
                    }

                    if (!currentElement) {
                        console.warn(`Could not find element for part: ${part} in context:`, currentElement);
                        return null;
                    }
                    
                    // If there are more parts to process
                    if (i < parts.length - 1) {
                        // The current element should be a shadow host
                        if (!currentElement.shadowRoot) {
                            console.warn(`No shadow root found on element:`, currentElement);
                            return null;
                        }
                        currentElement = currentElement.shadowRoot;
                    }
                } catch (e) {
                    console.error(`Error evaluating part: ${part}`, e);
                    console.error(e);
                    return null;
                }
            }
            return currentElement;
        } else {
            // Regular XPath without shadow DOM
            try {
                const result = document.evaluate(
                    selector,
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                );
                return result.singleNodeValue;
            } catch (e) {
                console.error(`Error evaluating XPath: ${selector}`, e);
                return null;
            }
        }
    } else {
        // Use CSS selector
        return document.querySelector(selector);
    }
}

// Helper function to clean up XPath
function cleanXPath(xpath) {
    // Remove duplicate path segments
    return xpath.replace(/\/html\/html\/body\/html\/body/, '/html/body')
               .replace(/\/\//g, '//')  // Keep custom element separators
               .replace(/([^/])\/(\/[^/])/g, '$1$2'); // Remove duplicate single slashes
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

  return new Promise(resolve => {
    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function for smooth movement
      const easeOutCubic = progress => 1 - Math.pow(1 - progress, 3);
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
      console.error('No selector provided');
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
    element.style.outline = '2px solid red';

    // Animate cursor to target position
    await animateCursorTo(x, y);
    
    // Show click animation
    showClickIndicator(x, y);

    // Trigger events after cursor reaches the target
    ['mousedown', 'mouseup', 'click'].forEach(eventType => {
      element.dispatchEvent(new MouseEvent(eventType, {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y
      }));
    });
    
    // Remove highlight after a delay
    setTimeout(() => {
      element.style.outline = originalOutline;
    }, 500);
    
    return true;
  } catch (error) {
    console.error('Error in click handler:', error);
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
  const overlays = document.querySelectorAll('div[style*="position: absolute"][style*="z-index: 999999"]');
  overlays.forEach(overlay => overlay.remove());

  // Remove any debug screenshot overlays
  const debugOverlays = document.querySelectorAll('div[style*="position: fixed"][style*="z-index: 10000"]');
  debugOverlays.forEach(overlay => overlay.remove());

  // Remove any click indicators
  const indicators = document.querySelectorAll('div[style*="position: fixed"][style*="border-radius: 50%"]');
  indicators.forEach(indicator => indicator.remove());
}

// Function to get the list of interactive elements
function getInteractiveElementsList() {
  const list = Array.from(interactiveElementsMap.values());
  console.log('Complete Interactive Elements List:', list);
  return list;
}

// Add fill handler function
async function handleFill(selector, value) {
  try {
    if (!selector || !value) {
      console.error('No selector or value provided');
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
    element.style.outline = '2px solid blue';

    // Animate cursor to target position
    await animateCursorTo(x, y);
    
    // Show click indicator
    showClickIndicator(x, y, '#3399FF');

    // Focus the element
    element.focus();

    // Clear existing value if it's an input or textarea
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      element.value = '';
    }

    // Type the value character by character
    for (const char of value) {
      element.value = element.value + char;
      // Dispatch input event after each character
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 50)); // Add slight delay between characters
    }

    // Dispatch change event after filling
    element.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Remove highlight after a delay
    setTimeout(() => {
      element.style.outline = originalOutline;
    }, 500);
    
    return true;
  } catch (error) {
    console.error('Error in fill handler:', error);
    return false;
  }
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
    } else if (message.type === "PERFORM_CLICK") {
      const elementData = interactiveElementsMap.get(parseInt(message.index));
      console.log('Attempting to click element:', {
        requestedIndex: message.index,
        foundElement: elementData
      });
      if (!elementData) {
        sendResponse({ success: false, error: `No element found with index: ${message.index}` });
        return true;
      }
      
      handleClick(elementData.xpath)
        .then(success => {
          sendResponse({ success });
        })
        .catch(error => {
          console.error('Error performing click:', error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.type === "PERFORM_FILL") {
      const elementData = interactiveElementsMap.get(parseInt(message.index));
      console.log('Attempting to fill element:', {
        requestedIndex: message.index,
        foundElement: elementData,
        value: message.value
      });
      if (!elementData) {
        sendResponse({ success: false, error: `No element found with index: ${message.index}` });
        return true;
      }
      
      handleFill(elementData.xpath, message.value)
        .then(success => {
          sendResponse({ success });
        })
        .catch(error => {
          console.error('Error performing fill:', error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.type === "SEARCH_GOOGLE") {
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(message.query)}`;
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
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
          // For special keys like Enter, Backspace, etc.
          if (message.keys.includes('+') || message.keys.length > 1) {
            const event = new KeyboardEvent('keydown', {
              key: message.keys,
              code: message.keys,
              bubbles: true,
              cancelable: true,
              composed: true
            });
            activeElement.dispatchEvent(event);
          } else {
            // For regular text input
            activeElement.value += message.keys;
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            activeElement.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error sending keys:', error);
        sendResponse({ success: false, error: error.message });
      }
    } else if (message.type === "EXTRACT_CONTENT") {
      try {
        let content;
        if (message.format === 'text') {
          content = document.body.innerText;
        } else if (message.format === 'markdown') {
          // Simple HTML to Markdown conversion
          content = document.body.innerHTML
            .replace(/<h[1-6]>(.*?)<\/h[1-6]>/g, '# $1\n')
            .replace(/<p>(.*?)<\/p>/g, '$1\n')
            .replace(/<a href="(.*?)">(.*?)<\/a>/g, '[$2]($1)')
            .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
            .replace(/<em>(.*?)<\/em>/g, '*$1*')
            .replace(/<.*?>/g, '');
        } else {
          content = document.body.innerHTML;
        }
        sendResponse({ success: true, content });
      } catch (error) {
        console.error('Error extracting content:', error);
        sendResponse({ success: false, error: error.message });
      }
    } else if (message.type === "GET_PAGE_MARKUP") {
      console.log('Starting page markup analysis...');
      
      // Clean up before getting markup
      cleanupExtensionMarkup();
      
      // Reset interactive elements tracking
      resetInteractiveElements();
      console.log('Reset interactive elements tracking');
      
      // Build the DOM tree and collect interactive elements
      buildDomTree(document.body, {
        doHighlightElements: false,
        includeShadowRoots: true,
        includeIFrames: true,
        includeTextNodes: true,
        observeMutations: false
      }).then(() => {
        // Get and log the list of interactive elements
        const interactiveElements = getInteractiveElementsList();
        console.log(`Found ${interactiveElements.length} interactive elements`);
        
        sendResponse({ 
          success: true,
          interactiveElements
        });
      }).catch(error => {
        console.error('Error building interactive elements list:', error);
        sendResponse({ 
          success: false,
          error: 'Failed to build interactive elements list: ' + error.message
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
    console.error('Error in content script:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  // Return true to indicate we'll send a response asynchronously
  return true;
});

// Create or update the cursor position
function updateCursor(x, y) {
  if (!cursorElement) {
    cursorElement = document.createElement('div');
    
    // Create the cursor pointer element
    const pointer = document.createElement('div');
    Object.assign(pointer.style, {
      width: '20px',
      height: '20px',
      position: 'absolute',
      top: '0',
      left: '0',
      backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="%23FF5733"><path d="M7 2l12 11.2-5.8.5 3.3 7.3-2.2 1-3.2-7-4.1 4z"/></svg>')`,
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
      pointerEvents: 'none',
    });
    
    // Create the name label
    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'absolute',
      left: '20px',
      top: '0',
      backgroundColor: '#FF5733',
      color: 'white',
      padding: '2px 6px',
      borderRadius: '3px',
      fontSize: '12px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      userSelect: 'none',
    });
    label.textContent = 'AI Assistant';
    
    cursorElement.appendChild(pointer);
    cursorElement.appendChild(label);
    
    // Style the container
    Object.assign(cursorElement.style, {
      position: 'fixed',
      zIndex: '999998',
      pointerEvents: 'none',
      transition: 'transform 0.1s ease-out',
      left: '0',
      top: '0',
    });
    
    document.body.appendChild(cursorElement);
  }
  
  // Update cursor position with smooth transition
  cursorElement.style.transform = `translate(${x}px, ${y}px)`;
}

// Create and animate a visual click indicator
function showClickIndicator(x, y, color = '#FF5733') {
  const indicator = document.createElement('div');
  
  // Style the indicator
  Object.assign(indicator.style, {
    position: 'fixed',
    left: `${x - 5}px`,  // Center the 10px dot
    top: `${y - 5}px`,
    width: '10px',
    height: '10px',
    backgroundColor: color,
    borderRadius: '50%',
    pointerEvents: 'none',
    zIndex: '999999',
    opacity: '0.8',
    transform: 'scale(1)',
    transition: 'all 0.5s ease-out',
  });

  document.body.appendChild(indicator);

  // Animate the indicator
  requestAnimationFrame(() => {
    indicator.style.transform = 'scale(2)';
    indicator.style.opacity = '0';
  });

  // Remove the indicator after animation
  setTimeout(() => {
    indicator.remove();
  }, 500);
}