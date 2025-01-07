// background.js

// Add API key management functions at the top of the file
async function getOpenAIKey() {
  const result = await chrome.storage.local.get(['openai_api_key']);
  return result.openai_api_key;
}

async function setOpenAIKey(apiKey) {
  await chrome.storage.local.set({ openai_api_key: apiKey });
}

// Store active connections
const ports = new Map();

// Function to clean up extension markup before screenshot
async function cleanupExtensionMarkup(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "CLEANUP_MARKUP"
    });
    // Give a small delay for the cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    console.warn('Failed to cleanup markup:', error);
  }
}

// Function to handle screenshot capture
async function handleScreenshotCapture(prompt, tabId, port = null) {
  try {
    // Get the window ID for the tab
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      throw new Error('Tab not found');
    }

    // Clean up any extension markup before taking screenshot
    await cleanupExtensionMarkup(tab.id);

    // Capture the screenshot
    const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    console.log('Screenshot captured successfully');
    
    // Get debug mode setting
    const { debug_mode } = await chrome.storage.local.get({ debug_mode: false });
    
    // If debug mode is enabled, send screenshot to content script
    if (debug_mode) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "DEBUG_SCREENSHOT",
          imageUri: screenshotUrl
        });
        console.log('Debug screenshot sent to content script');
        
        // If we have a port (sidebar connection), send debug screenshot there too
        if (port) {
          port.postMessage({
            type: "DEBUG_SCREENSHOT",
            imageUri: screenshotUrl
          });
          console.log('Debug screenshot sent to sidebar');
        }
      } catch (error) {
        console.warn('Failed to send debug screenshot:', error);
      }
    }
    
    // Send to AI service
    const response = await sendPromptAndScreenshotToServer(prompt, screenshotUrl);
    console.log('AI service response received');
    
    // Send the response to the content script for handling
    if (response.success) {
      const actionData = JSON.parse(response.response);
      if (actionData.action === "click") {
        await chrome.tabs.sendMessage(tabId, {
          type: "PERFORM_CLICK",
          index: actionData.index
        });
      } else if (actionData.action === "fill") {
        await chrome.tabs.sendMessage(tabId, {
          type: "PERFORM_FILL",
          index: actionData.index,
          value: actionData.value
        });
      } else if (actionData.action === "search_google") {
        await chrome.tabs.sendMessage(tabId, {
          type: "SEARCH_GOOGLE",
          query: actionData.query
        });
      } else if (actionData.action === "go_to_url") {
        await chrome.tabs.sendMessage(tabId, {
          type: "GO_TO_URL",
          url: actionData.url
        });
      } else if (actionData.action === "go_back") {
        await chrome.tabs.sendMessage(tabId, {
          type: "GO_BACK"
        });
      } else if (actionData.action === "scroll_down") {
        await chrome.tabs.sendMessage(tabId, {
          type: "SCROLL_DOWN",
          amount: actionData.amount
        });
      } else if (actionData.action === "scroll_up") {
        await chrome.tabs.sendMessage(tabId, {
          type: "SCROLL_UP",
          amount: actionData.amount
        });
      } else if (actionData.action === "send_keys") {
        await chrome.tabs.sendMessage(tabId, {
          type: "SEND_KEYS",
          keys: actionData.keys
        });
      } else if (actionData.action === "extract_content") {
        await chrome.tabs.sendMessage(tabId, {
          type: "EXTRACT_CONTENT",
          format: actionData.format
        });
      }
    }
    
    return { success: true, response };
  } catch (error) {
    console.error('Error handling screenshot capture:', error);
    return { success: false, error: error.message };
  }
}

// Handle connection from sidebar
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sidebar") {
    // Store the port with a unique ID
    const portId = Date.now().toString();
    ports.set(portId, port);
    
    port.onDisconnect.addListener(() => {
      ports.delete(portId);
      console.log(`Port disconnected: ${portId}`);
    });

    // Initialize cursor when sidebar connects
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (tab) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "INIT_CURSOR" });
        } catch (error) {
          console.warn('Failed to initialize cursor:', error);
        }
      }
    });

    port.onMessage.addListener(async (message) => {
      console.log('Received message in background:', message);
      if (message.type === "CAPTURE_SCREENSHOT") {
        const result = await handleScreenshotCapture(message.prompt, message.tabId, port);
        port.postMessage({
          type: "AI_RESPONSE",
          success: result.success,
          serverResponse: result.success ? result.response : undefined,
          error: result.success ? undefined : result.error
        });
      }
    });
  }
});

// Function to send message to tab with retry
async function sendMessageToTab(tabId, message, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed:`, error);
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Initialize side panel behavior when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  // Configure the side panel to open when the action button is clicked
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));
});

// Toggle the sidebar on the current tab when the user clicks the extension icon
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Open the side panel in the current tab
    await chrome.sidePanel.open({ tabId: tab.id });
    
    // Initialize the cursor in the content script
    await chrome.tabs.sendMessage(tab.id, { type: "INIT_CURSOR" });
  } catch (error) {
    console.error('Failed to open side panel:', error);
  }
});

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SET_OPENAI_KEY") {
    setOpenAIKey(request.apiKey)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;  // Will respond asynchronously
  }

  if (request.type === "CAPTURE_SCREENSHOT") {
    // Use the tabId from the request if available, otherwise use sender.tab.id
    const tabId = request.tabId || sender.tab.id;
    
    // Handle screenshot capture and send response
    handleScreenshotCapture(request.prompt, tabId)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    
    return true;  // Will respond asynchronously
  }

  if (request.type === "SWITCH_TAB") {
    chrome.tabs.update(request.tabId, { active: true });
    return true;
  }

  if (request.type === "OPEN_NEW_TAB") {
    chrome.tabs.create({ url: request.url });
    return true;
  }
});

// Function to trim DOM tree to reduce size and focus on relevant elements
function trimDOMTree(tree) {
  if (!tree) return null;

  // Helper function to process a node
  function processNode(node) {
    if (!node) return null;

    // For element nodes
    if (node.nodeType === 'element') {
      // Skip script and style elements
      if (['script', 'style', 'meta', 'link'].includes(node.tagName?.toLowerCase())) {
        return null;
      }

      // Create a minimal version of the node
      const trimmedNode = {
        nodeType: node.nodeType,
        xpath: node.xpath,  // Keep xpath for precise identification
        isInteractive: node.isInteractive  // Keep interactivity flag
      };

      // Only include minimal identifying attributes
      if (node.attributes) {
        const essentialAttrs = ['aria-label', 'role', 'id'];
        const labelAttrs = Object.entries(node.attributes)
          .filter(([key, value]) => {
            // Keep attributes that likely contain identifying text
            return essentialAttrs.includes(key) ||
                   key.includes('label') ||
                   key.includes('text') ||
                   key.includes('title') ||
                   key.includes('placeholder');
          });

        if (labelAttrs.length > 0) {
          trimmedNode.attributes = Object.fromEntries(labelAttrs);
        }
      }

      // Process children recursively
      if (node.children && node.children.length > 0) {
        const processedChildren = node.children
          .map(child => processNode(child))
          .filter(child => child !== null);

        if (processedChildren.length > 0) {
          trimmedNode.children = processedChildren;
        }
      }

      // Keep text content if it's a leaf node with text
      if (node.textContent && !trimmedNode.children) {
        const text = node.textContent.trim();
        if (text) {
          trimmedNode.text = text.substring(0, 100); // Limit text length
        }
      }

      return trimmedNode;
    }
    // For text nodes, only keep if they contain meaningful text
    else if (node.nodeType === 'text' && node.content) {
      const text = node.content.trim();
      if (text) {
        return {
          nodeType: 'text',
          content: text.substring(0, 100) // Limit text length
        };
      }
    }
    // For document/fragment nodes
    else if (node.nodeType === 'document' || node.nodeType === 'documentFragment') {
      const containerNode = {
        nodeType: node.nodeType,
        xpath: node.xpath
      };
      
      if (node.children && node.children.length > 0) {
        const processedChildren = node.children
          .map(child => processNode(child))
          .filter(child => child !== null);
        
        if (processedChildren.length > 0) {
          containerNode.children = processedChildren;
        }
      }
      
      return containerNode;
    }

    return null;
  }

  const trimmed = processNode(tree);
  const originalSize = JSON.stringify(tree).length;
  const trimmedSize = trimmed ? JSON.stringify(trimmed).length : 0;
  
  console.log('Trimming stats:', {
    originalSize,
    trimmedSize,
    reductionPercent: trimmed ? 
      Math.round((1 - trimmedSize / originalSize) * 100) : 100
  });
  
  return trimmed;
}

// Function to send prompt + screenshot to AI provider
async function sendPromptAndScreenshotToServer(prompt, base64Screenshot) {
  console.log('Starting AI service request with prompt:', prompt);
  
  // Get provider and settings from storage
  const { 
    provider,
    openai_api_key,
    openai_model,
    gemini_api_key,
    gemini_model,
    system_prompt 
  } = await chrome.storage.local.get({
    provider: 'openai',
    openai_api_key: '',
    openai_model: 'gpt-4o-min',
    gemini_api_key: '',
    gemini_model: 'gemini-2.0-flash-exp',
    system_prompt: `You are a precise browser automation agent that interacts with websites through structured commands. Your role is to:
1. Analyze the provided webpage elements and structure
2. Plan a sequence of actions to accomplish the given task
3. Respond with valid JSON containing your action sequence and state assessment
4. Support both click and fill actions for form interactions`
  });

  console.log('Using AI provider:', provider);
  console.log('Using model:', provider === 'openai' ? openai_model : gemini_model);

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('Got active tab:', tab.id);
  
  // Get the interactive elements list
  let interactiveElements = null;
  try {
    console.log('Requesting interactive elements from content script');
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_MARKUP" });
    
    if (!response.success) {
      console.error('Failed to get interactive elements:', response.error);
      throw new Error(response.error || 'Failed to get interactive elements');
    }
    
    interactiveElements = response.interactiveElements;
    if (!interactiveElements || !Array.isArray(interactiveElements)) {
      console.error('Invalid interactive elements data:', interactiveElements);
      throw new Error('Invalid interactive elements data received from content script');
    }

    console.log('All Interactive Elements:', interactiveElements);
  } catch (error) {
    console.error('Failed to get page data:', error);
    throw new Error('Failed to analyze page structure: ' + error.message);
  }

  // Add interactive elements to the prompt
  console.log('Building enhanced prompt with', interactiveElements.length, 'interactive elements');
  const enhancedPrompt = `
As a browser automation agent, analyze the following webpage elements and help with: ${prompt}

The page contains the following list of interactive elements, each with a unique index:

\`\`\`json
${JSON.stringify(interactiveElements, null, 2)}
\`\`\`

Based on these elements and the screenshot, determine the appropriate action to take. Available actions:

1. Click: Click on an interactive element by index
2. Fill: Input text into a form field by index
3. Search Google: Search Google in the current tab
4. Navigate: Go to URLs or go back in history
5. Scroll: Scroll the page up or down
6. Send Keys: Send keyboard inputs to the active element
7. Extract Content: Get page content as text or markdown

Respond with a JSON object containing:
{
  "action": "The type of action to perform (click, fill, search_google, go_to_url, go_back, scroll_down, scroll_up, send_keys, extract_content)",
  "index": "The index number of the element to interact with (for click and fill)",
  "description": "A clear description of what will be done",
  "value": "The value to fill (for fill action)",
  "query": "The search query (for search_google action)",
  "url": "The URL to navigate to (for go_to_url action)",
  "amount": "The scroll amount in pixels (optional for scroll actions)",
  "keys": "The keys to send (for send_keys action)",
  "format": "The output format for extract_content (text or markdown)"
}

Choose the most appropriate action based on the user's request.`;

  console.log('Enhanced prompt built, sending to AI service');
  let response;
  try {
    if (provider === 'openai') {
      console.log('Sending to OpenAI');
      response = await sendToOpenAI(enhancedPrompt, base64Screenshot, openai_api_key, openai_model, system_prompt);
      console.log('Received response from OpenAI:', response);
    } else {
      console.log('Sending to Gemini');
      response = await sendToGemini(enhancedPrompt, base64Screenshot, gemini_api_key, gemini_model, system_prompt);
      console.log('Received response from Gemini:', response);
    }
  } catch (error) {
    console.error('AI service error:', error);
    throw error;
  }

  return response;
}

// Update the OpenAI schema
async function sendToOpenAI(prompt, base64Screenshot, apiKey, model, systemPrompt) {
  console.log('Preparing OpenAI request');
  if (!apiKey) {
    throw new Error("OpenAI API key not set. Please set your API key in the extension options.");
  }

  const OPENAI_API_ENDPOINT = "https://api.openai.com/v1/chat/completions";
  const requestBody = {
    model: model,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt
          },
          {
            type: "image_url",
            image_url: {
              url: base64Screenshot
            }
          }
        ]
      }
    ],
    max_tokens: 1000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "browser_automation_action",
        description: "Structured response for browser automation actions using element indices",
        schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["click", "fill", "search_google", "go_to_url", "go_back", "scroll_down", "scroll_up", "send_keys", "extract_content"],
              description: "The type of action to perform"
            },
            index: {
              type: "number",
              description: "The index number of the interactive element to interact with (required for click and fill actions)"
            },
            value: {
              type: "string",
              description: "The value to fill in the element (required for fill action)"
            },
            description: {
              type: "string",
              description: "Clear description of what will be done"
            },
            query: {
              type: "string",
              description: "The search query (required for search_google action)"
            },
            url: {
              type: "string",
              description: "The URL to navigate to (required for go_to_url action)"
            },
            amount: {
              type: "number",
              description: "The scroll amount in pixels (optional for scroll actions)"
            },
            keys: {
              type: "string",
              description: "The keys to send (required for send_keys action)"
            },
            format: {
              type: "string",
              enum: ["text", "markdown", "html"],
              description: "The output format (required for extract_content action)"
            }
          },
          required: ["action", "description"],
          additionalProperties: false
        }
      }
    }
  };

  console.log('Sending request to OpenAI API');
  const response = await fetch(OPENAI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  console.log('Received response from OpenAI API');
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error('OpenAI API error:', errorData);
    throw new Error(`OpenAI API error: ${response.statusText}${errorData ? ' - ' + JSON.stringify(errorData) : ''}`);
  }

  const data = await response.json();
  console.log('Successfully parsed OpenAI response');
  return {
    response: data.choices[0].message.content,
    success: true
  };
}

// Update Gemini validation
async function sendToGemini(prompt, base64Screenshot, apiKey, model, systemPrompt) {
  console.log('Preparing Gemini request');
  if (!apiKey) {
    throw new Error("Gemini API key not set. Please set your API key in the extension options.");
  }

  try {
    const GEMINI_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Prepare the prompt with system instructions and user query
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    // Create the request body
    const requestBody = {
      contents: [{
        role: "user",
        parts: [
          {
            text: fullPrompt
          },
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Screenshot.replace(/^data:image\/[a-z]+;base64,/, "")
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.4,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
        responseMimeType: "text/plain"
      }
    };

    console.log('Sending request to Gemini API');
    const response = await fetch(GEMINI_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    console.log('Received response from Gemini API');
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('Gemini API error:', errorData);
      throw new Error(`API error: ${response.statusText}${errorData ? ' - ' + JSON.stringify(errorData) : ''}`);
    }

    const data = await response.json();
    console.log('Successfully parsed Gemini response');
    let content = data.candidates[0].content.parts[0].text;

    // Extract JSON from response if wrapped in markdown
    if (content.includes("```json")) {
      content = content.split("```json")[1].split("```")[0].trim();
    }

    // Validate JSON format focusing on index
    const parsed = JSON.parse(content);
    if (typeof parsed.index !== 'number' || !parsed.description) {
      throw new Error("Invalid response format from Gemini");
    }

    return {
      response: content,
      success: true
    };
  } catch (error) {
    console.error('Error in Gemini request:', error);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

