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

    // If the element has its own ID, just return that
    if (node.id) {
      return `//*[@id="${node.id}"]`;
    }

    let path = "";
    let current = node;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      // If this node has an ID, build a partial path from here down
      if (current.id) {
        return `//*[@id="${current.id}"]${path}`;
      }

      // Find how many previous siblings share the same tagName
      let index = 0;
      let sibling = current.previousSibling;
      while (sibling) {
        if (
          sibling.nodeType === Node.ELEMENT_NODE &&
          sibling.nodeName === current.nodeName
        ) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      // Build the path segment
      const tagName = current.nodeName.toLowerCase();
      const pathIndex = index ? `[${index + 1}]` : "";
      path = `/${tagName}${pathIndex}${path}`;

      // Move up the DOM tree
      current = current.parentNode;
    }

    return path;
  }

  /**
   * isInteractiveElement - Checks if an element should be considered "interactive."
   * Extends standard clickable tags (a, button, etc.) with ARIA roles, tabIndex, and
   * inline event attributes (onmousedown, onclick, etc.).
   */
  function isInteractiveElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const tagName = element.tagName.toLowerCase();
    // Known interactive HTML tags
    const interactiveTags = ["a", "button", "input", "select", "textarea"];
    if (interactiveTags.includes(tagName)) return true;

    // Inline event attributes
    const eventAttributes = [
      "onclick",
      "onmousedown",
      "onmouseup",
      "onmouseover",
      "onmouseout",
      "onchange",
      "onfocus",
      "onblur",
    ];
    for (let attr of eventAttributes) {
      if (element.hasAttribute(attr)) return true;
    }

    // ARIA roles
    const role = element.getAttribute("role");
    const interactiveRoles = [
      "button",
      "link",
      "checkbox",
      "radio",
      "tab",
      "menuitem",
      "treeitem"
    ];
    if (role && interactiveRoles.includes(role.toLowerCase())) {
      return true;
    }

    // Non-negative tabIndex
    if (
      element.hasAttribute("tabindex") &&
      element.getAttribute("tabindex") !== "-1"
    ) {
      return true;
    }

    return false;
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
  function isElementVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity) === 0
    ) {
      return false;
    }

    // Check the offset dimension for real size
    if (el.offsetWidth === 0 && el.offsetHeight === 0) {
      return false;
    }
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

  async function traverse(node) {
    if (!node) return null;

    // ELEMENT_NODE
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;

      // Filter out some tags
      const ignoredTags = ["script", "style", "link", "meta", "svg"];
      if (ignoredTags.includes(el.tagName.toLowerCase())) {
        return null;
      }

      // Check if element is interactive and visible
      const isVisible = isElementVisible(el);
      const isInteractive = isInteractiveElement(el);

      // If element is both interactive and visible, add it to our map
      if (isInteractive && isVisible) {
        const elementData = {
          index: currentHighlightIndex,
          tagName: el.tagName.toLowerCase(),
          xpath: getXPathTree(el),
          text: el.textContent?.trim().substring(0, 100) || '',
          attributes: {}
        };

        // Gather identifying attributes
        for (const attr of el.attributes) {
          if (['id', 'class', 'name', 'title', 'aria-label', 'role', 'type'].includes(attr.name)) {
            elementData.attributes[attr.name] = attr.value;
          }
        }

        // Store in map
        interactiveElementsMap.set(currentHighlightIndex, elementData);
        
        // Optional highlighting for debugging
        if (doHighlightElements) {
          highlightElement(el, `${currentHighlightIndex}: <${elementData.tagName}>`);
        }

        currentHighlightIndex++;
      }

      // Recurse into children
      const children = [];
      for (const child of el.childNodes) {
        const childData = await traverse(child);
        if (childData) {
          children.push(childData);
        }
      }

      return children.length > 0 ? { children } : null;
    }

    return null;
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
    // Use XPath
    const result = document.evaluate(
      selector,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } else {
    // Use CSS selector
    return document.querySelector(selector);
  }
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