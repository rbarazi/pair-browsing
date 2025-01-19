// Import storage service
import { conversationStorage } from './storage.js';

// Store active connections
const ports = new Map();

// Helper function to send messages to sidebar
async function sendDebugMessage(port, message) {
  // Get debug mode setting
  const { debug_mode } = await chrome.storage.local.get({ debug_mode: false });

  if (debug_mode) {
    sendSidebarMessage(port, message);
  }
}

async function sendSidebarMessage(port, message) {
  if (port) {
    port.postMessage({
      type: "ASSISTANT_MESSAGE",
      message
    });
  }
}

// Clear AI conversation history
async function clearAIHistory() {
  await conversationStorage.clearHistory();
  console.log('AI conversation history cleared');
}

// Update conversation history
async function updateHistory(newEntry) {
  try {
    await conversationStorage.addEntry(newEntry);
    console.log('History updated:', newEntry);
  } catch (error) {
    console.error('Failed to update history:', error);
  }
}
// Reset session state
async function resetSession(port, tabId) {
  // Clear conversation history
  clearAIHistory();
  
  // Reinitialize cursor
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "INIT_CURSOR" });
      console.log('Cursor reinitialized');
    } catch (error) {
      console.warn('Failed to reinitialize cursor:', error);
    }
  }
  
  // Notify sidebar that reset is complete
  port.postMessage({
    type: "SESSION_RESET",
    success: true
  });
  
  console.log('Session reset complete');
}

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

// Function to wait for page load completion
async function waitForPageLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(); // Resolve anyway after timeout to prevent hanging
    }, 10000); // 10 second timeout

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(updatedListener);
    };

    const checkDocumentReady = async () => {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: "CHECK_DOCUMENT_READY" });
        if (response?.ready) {
          cleanup();
          resolve();
        }
      } catch (error) {
        console.warn('Failed to check document ready state:', error);
      }
    };

    // First, check current tab status
    chrome.tabs.get(tabId, async (tab) => {
      if (chrome.runtime.lastError) {
        cleanup();
        reject(chrome.runtime.lastError);
        return;
      }

      if (tab.status === 'complete') {
        // Give a small delay to ensure rendering
        await new Promise(r => setTimeout(r, 100));
        await checkDocumentReady();
      }
    });

    // Listen for tab updates
    const updatedListener = async (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId) {
        if (changeInfo.status === 'complete') {
          // Give a small delay to ensure rendering
          await new Promise(r => setTimeout(r, 100));
          await checkDocumentReady();
        } else if (changeInfo.status === 'loading') {
          // Reset any previous ready state
          console.log('Page started loading, waiting for completion...');
        }
      }
    };

    chrome.tabs.onUpdated.addListener(updatedListener);
  });
}

class ScreenshotManager {
  constructor() {
    this.debugMode = false;
  }

  async initialize() {
    const { debug_mode } = await chrome.storage.local.get({ debug_mode: false });
    this.debugMode = debug_mode;
  }

  async captureScreenshot(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      throw new Error('Tab not found');
    }
    
    // Capture the screenshot
    const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    console.log('Screenshot captured successfully');

    // Clean up any extension markup after taking screenshot
    await cleanupExtensionMarkup(tab.id);
    
    return screenshotUrl;
  }

  async sendDebugScreenshot(tabId, port, screenshotUrl) {
    if (!this.debugMode) return;

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "DEBUG_SCREENSHOT",
        imageUri: screenshotUrl
      });
      console.log('Debug screenshot sent to content script');
      
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
}

// Function to handle screenshot capture
async function promptAI(prompt, tabId, port = null, stepCounter = 0, retryCounter = 0) {
  const screenshotManager = new ScreenshotManager();
  await screenshotManager.initialize();

  const maxSteps = 10;
  const maxRetries = 5;

  try {
    // Get interactive elements
    const stringifiedInteractiveElements = await getInteractiveElements(tabId);

    // Capture screenshot
    const screenshotUrl = await screenshotManager.captureScreenshot(tabId);
    await screenshotManager.sendDebugScreenshot(tabId, port, screenshotUrl);

    const response = await sendPromptAndScreenshotToServer(
      prompt,
      screenshotUrl,
      stringifiedInteractiveElements
    );
    console.log("AI service response received:", response);

    if (response.success) {
      const responseData = JSON.parse(response.response);
      await updateHistory({ role: "assistant", content: response.response });

      console.log("Parsed response data:", responseData);

      const state = responseData.current_state;
      // Send initial task description to sidebar
      if (stepCounter > 0) {
        sendSidebarMessage(port,`Step ${stepCounter-1} Evaluation: ${state.evaluation_previous_goal}`);
        sendSidebarMessage(port,`Step ${stepCounter}: ${state.next_goal}, actions: ${responseData.actions.length}`);
      } else {
        sendSidebarMessage(port,`Task started: ${prompt}`);
      }

      // Create action handler instance
      const actionHandler = new ActionHandler(tabId, port);

      // Check for done action first
      const doneAction = responseData.actions.find(action => action.action === 'done');
      if (doneAction) {
        sendSidebarMessage(port, `Task completed: ${doneAction.description}`);
        return { success: true, response, isDone: true };
      }

      // Execute actions sequentially with proper waiting
      for (const actionData of responseData.actions) {
        // Send action description to sidebar
        sendSidebarMessage(port,`Action ${responseData.actions.indexOf(actionData)+1}/${responseData.actions.length}: ${actionData.description}`);
        
        // Wait for the action to complete
        try {
          await actionHandler.handleAction(actionData);
        } catch (error) {
          console.error('Action failed:', error);
          throw error;
        }
      }

      // Evaluate the task that was just done
      // get fresh screenshot and interactive elements
      const resultScreenshotUrl = await screenshotManager.captureScreenshot(tabId);
      const resultStringifiedInteractiveElements = await getInteractiveElements(tabId);
      const evaluationResponse = await sendPromptAndScreenshotToServer(
        `Evaluate the task: <evaluated-task>${prompt}</evaluated-task>.`,
        resultScreenshotUrl,
        resultStringifiedInteractiveElements
      );

      if (evaluationResponse.success) {
        const evaluationData = JSON.parse(evaluationResponse.response);
        const evaluationState = evaluationData.current_state;

        if (evaluationState.evaluation_previous_goal === 'Success') {
          if (!evaluationState.next_goal || evaluationState.next_goal === null) {
            sendSidebarMessage(
              port,
              `Task Completed Successfully: ${evaluationState.evaluation_previous_goal}`
            );
            return { success: true, response };
          } else {
            stepCounter++;
            if (stepCounter >= maxSteps) {
              console.warn('Max steps reached');
              return { success: false, error: 'Max steps reached' };
            }
            sendSidebarMessage(
              port,
              `Step: ${stepCounter}`
            );
            sendSidebarMessage(
              port,
              `Next goal: ${evaluationState.next_goal}`
            );

            return await promptAI(evaluationState.next_goal, tabId, port, stepCounter, retryCounter);
          }
        } else if (evaluationState.evaluation_previous_goal === 'Failed' || evaluationState.evaluation_previous_goal === 'Unknown') {
          if (evaluationState.next_goal) {
            sendDebugMessage(
              port,
              `Retry: ${retryCounter}`
            );

            retryCounter++;
            if (retryCounter >= maxRetries) {
              console.warn('Max retries reached');
              return { success: false, error: 'Max retries reached' };
            }
            return await promptAI(evaluationState.next_goal, tabId, port, stepCounter, retryCounter);
          }
        }
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
    // Clear history at the start of new session
    resetSession(port, null);
    
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
          await initializeCursorWithRetry(tab.id);
        } catch (error) {
          console.warn('Failed to initialize cursor:', error);
        }
      }
    });

    // Listen for tab updates to reinitialize cursor when needed
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        try {
          // Wait a bit for the page to stabilize
          await new Promise(resolve => setTimeout(resolve, 500));
          await initializeCursorWithRetry(tabId);
        } catch (error) {
          console.warn('Failed to reinitialize cursor on tab update:', error);
        }
      }
    });

    port.onMessage.addListener(async (message) => {
      console.log('Received message in background:', message);
      if (message.type === "PROMPT_AI") {
        const result = await promptAI(
          message.prompt,
          message.tabId,
          port,
          []
        );
        port.postMessage({
          type: "AI_RESPONSE",
          success: result.success,
          serverResponse: result.success ? result.response : undefined,
          error: result.success ? undefined : result.error,
        });
      } else if (message.type === "RESET_SESSION") {
        await resetSession(port, message.tabId);
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
  if (request.type === "SWITCH_TAB") {
    chrome.tabs.update(request.tabId, { active: true });
    return true;
  }

  if (request.type === "OPEN_NEW_TAB") {
    chrome.tabs.create({ url: request.url });
    return true;
  }
});

// Function to send prompt + screenshot to AI provider
async function sendPromptAndScreenshotToServer(prompt, base64Screenshot, stringifiedInteractiveElements = null) {
  console.log('Starting AI service request with prompt:', prompt);
  
  // Get provider and settings from storage
  const { provider } = await chrome.storage.local.get({ provider: 'openai' });

  updateHistory({ role: 'user', content: prompt, elements: stringifiedInteractiveElements, screenshot: base64Screenshot });

  let response;
  try {
    if (provider === 'openai') {
      response = await sendToOpenAI();
      console.log('OpenAI Response:', response);
    } else if (provider === 'ollama') {
      response = await sendToOllama();
      console.log('Ollama Response:', response);
    } else {
      response = await sendToGemini();
      console.log('Gemini Response:', response);
    }
  } catch (error) {
    console.error('AI service error:', error);
    throw error;
  }

  return response;
}

// Shared schema for browser automation responses
const BROWSER_AUTOMATION_SCHEMA = {
  type: "object",
  properties: {
    current_state: {
      type: "object",
      properties: {
        evaluation_previous_goal: {
          type: "string",
          enum: ["Success", "Failed", "Unknown"],
          description:
            "Success|Failed|Unknown - Analyze the current elements and the image to check if the previous goals/actions are successful like intended by the task. Ignore the action result. The website is the ground truth. Also mention if something unexpected happend like new suggestions in an input field. Shortly state why/why not",
        },
        memory: {
          type: "string",
          description:
            "Description of what has been done and what you need to remember until the end of the task",
        },
        next_goal: {
          type: "string",
          description:
            "What needs to be done with the next actions. ONLY RETURN THE NEXT GOAL IF THERE IS ONE, OTHERWISE DO NOT INCLUDE IT",
        },
      },
      required: ["evaluation_previous_goal"],
    },
    actions: {
      type: "array",
      description: "Sequence of actions to perform",
      items: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "click",
              "fill",
              "search_google",
              "go_to_url",
              "go_back",
              "scroll_down",
              "scroll_up",
              "send_keys",
              "done"
            ],
            description: "The type of action to perform",
          },
          description: {
            type: "string",
            description:
              "Clear description of what this specific action will do",
          },
          index: {
            type: "number",
            description:
              "The index number of the interactive element to interact with (required for click and fill actions)",
          },
          value: {
            type: "string",
            description:
              "The value to fill in the element (required for fill action)",
          },
          query: {
            type: "string",
            description: "The search query (required for search_google action)",
          },
          url: {
            type: "string",
            description:
              "The URL to navigate to (required for go_to_url action)",
          },
          amount: {
            type: "number",
            description:
              "The scroll amount in pixels (optional for scroll actions)",
          },
          keys: {
            type: "string",
            description: "The keys to send (required for send_keys action)",
          },
        },
        required: ["action", "description"],
      },
    },
  },
  required: ["current_state", "actions"],
};

// Update the OpenAI schema
async function sendToOpenAI() {
  // Get provider and settings from storage
  const { openai_api_key, openai_model, system_prompt } =
    await chrome.storage.local.get({
      openai_api_key: "",
      openai_model: "gpt-4o-min",
      system_prompt: "",
    });

  console.log("Preparing OpenAI request");
  if (!openai_api_key) {
    throw new Error(
      "OpenAI API key not set. Please set your API key in the extension options."
    );
  }

  const aiHistory = await conversationStorage.getAllHistory();
  // get the last message from the history
  const lastMessage = aiHistory[aiHistory.length - 1];
  // loop through the history messages except for the last one and add them to the messages array
  let messages = aiHistory.slice(0, -1).map((message) => {
    if (message.role === "user") {
      return {
        role: "user",
        parts: [{ text: message.content }],
      };
    } else if (message.role === "assistant") {
      return {
        role: "model",
        parts: [{ text: message.content }],
      };
    }
    return message;
  });

  // add the last message to the messages array
  messages.push({
    role: "user",
    content: [
      {
        type: "text",
        text: `
<task>${lastMessage.content}</task>
<interactive_elements>${lastMessage.elements}</interactive_elements>
`,
      },
      { type: "image_url", image_url: { url: lastMessage.screenshot } },
    ],
  });

  const OPENAI_API_ENDPOINT = "https://api.openai.com/v1/chat/completions";
  const requestBody = {
    model: openai_model,
    messages: [
      {
        role: "system",
        content: system_prompt,
      },
      ...messages,
    ],
    max_tokens: 1000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "browser_automation_sequence",
        description:
          "Structured response for a sequence of browser automation actions",
        schema: BROWSER_AUTOMATION_SCHEMA,
      },
    },
  };

  console.log("Sending request to OpenAI API");
  const response = await fetch(OPENAI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openai_api_key}`,
    },
    body: JSON.stringify(requestBody),
  });

  console.log("Received response from OpenAI API");
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error("OpenAI API error:", errorData);
    throw new Error(
      `OpenAI API error: ${response.statusText}${
        errorData ? " - " + JSON.stringify(errorData) : ""
      }`
    );
  }

  const data = await response.json();
  console.log("Successfully parsed OpenAI response");
  return {
    response: data.choices[0].message.content,
    success: true,
  };
}

// Add Ollama support
async function sendToOllama() {
  const { ollama_model, system_prompt } = await chrome.storage.local.get({
    ollama_model: "llama3.2-vision",
    system_prompt: "",
  });

  console.log("Preparing Ollama request");

  const aiHistory = await conversationStorage.getAllHistory();
  // get the last message from the history
  const lastMessage = aiHistory[aiHistory.length - 1];
  // loop through the history messages except for the last one and add them to the messages array
  let messages = aiHistory.slice(0, -1).map((message) => {
    if (message.role === "user") {
      return {
        role: "user",
        content: message.content
      };
    } else if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content
      };
    }
    return message;
  });

  // add the last message to the messages array
  messages.push({
    role: "user",
    content: [
      {
        type: "text",
        text: `
Your task is: ${lastMessage.content}
Interactive elements:
${lastMessage.elements}
`,
      },
      { type: "image_url", image_url: lastMessage.screenshot },
    ],
  });

  const OLLAMA_API_ENDPOINT = "http://localhost:11434/v1/chat/completions";
  const requestBody = {
    model: ollama_model,
    messages: [
      {
        role: "system",
        content: system_prompt,
      },
      ...messages,
    ],
    max_tokens: 1000,
    response_format: {
      type: "json_schema",
      schema: BROWSER_AUTOMATION_SCHEMA,
    },
  };

  console.log("Sending request to Ollama API");
  const response = await fetch(OLLAMA_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Authorization: `Bearer ollama`,
    },
    body: JSON.stringify(requestBody),
  });

  console.log("Received response from Ollama API");
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error("Ollama API error:", errorData);
    throw new Error(
      `Ollama API error: ${response.statusText}${
        errorData ? " - " + JSON.stringify(errorData) : ""
      }`
    );
  }

  const data = await response.json();
  console.log("Successfully parsed Ollama response");
  return {
    response: data.choices[0].message.content,
    success: true,
  };
}

// Update Gemini validation
async function sendToGemini() {
  const {
    gemini_api_key,
    gemini_model,
    system_prompt,
  } = await chrome.storage.local.get({
    gemini_api_key: "",
    gemini_model: "gemini-2.0-flash-exp",
    system_prompt: "",
  });

  console.log('Preparing Gemini request');
  if (!gemini_api_key) {
    throw new Error("Gemini API key not set. Please set your API key in the extension options.");
  }

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const GEMINI_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${gemini_model}:generateContent?key=${gemini_api_key}`;

      const aiHistory = await conversationStorage.getAllHistory();
      // get the last message from the history
      const lastMessage = aiHistory[aiHistory.length - 1];
      // loop through the history messages except for the last one and add them to the messages array
      let messages = aiHistory.slice(0, -1).map(message => {
        if (message.role === "user") {
          return {
            role: "user",
            parts: [{ text: message.content }],
          };
        } else if (message.role === "assistant") {
          return {
            role: "model",
            parts: [{ text: message.content }],
          };
        }
        return message;
      });

      // add the last message to the messages array
      messages.push({
        role: "user",
        parts: [
          {
            text: `
Your task is: ${lastMessage.content}
Interactive elements:
${lastMessage.elements}
`,
          },
          {
            inline_data: {
              mime_type: "image/png",
              data: lastMessage.screenshot.replace(
                /^data:image\/[a-z]+;base64,/,
                ""
              ),
            },
          },
        ],
      });

      // Create the request body
      const requestBody = {
        system_instruction: {
          parts:{
            text: system_prompt
          }
        },
        contents: [messages],
        generationConfig: {
          temperature: 0.4,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
          responseSchema: BROWSER_AUTOMATION_SCHEMA
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
        
        // Check if it's a resource exhaustion error
        if (response.status === 429) {
          retryCount++;
          if (retryCount < maxRetries) {
            // Notify user about retry through sidebar
            if (global.sidebarPort) {
              global.sidebarPort.postMessage({
                type: "ASSISTANT_MESSAGE",
                message: `Gemini API rate limit reached. Taking a 10-second break before retry ${retryCount}/${maxRetries}...`
              });
            }
            // Wait for 10 seconds before retrying
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
          }
        }
        throw new Error(`API error: ${response.statusText}${errorData ? ' - ' + JSON.stringify(errorData) : ''}`);
      }

      const data = await response.json();
      console.log('Successfully parsed Gemini response', data);
      let content = data.candidates[0].content.parts[0].text;

      // Extract JSON from response if wrapped in markdown
      if (content.includes("```json")) {
        content = content.split("```json")[1].split("```")[0].trim();
      }

      return {
        response: content,
        success: true
      };
    } catch (error) {
      console.error('Error in Gemini request:', error);
      if (retryCount >= maxRetries - 1) {
        throw new Error(`Gemini API error: ${error.message}`);
      }
      retryCount++;
      // Notify user about retry through sidebar
      if (global.sidebarPort) {
        global.sidebarPort.postMessage({
          type: "ASSISTANT_MESSAGE",
          message: `Error occurred. Taking a 10-second break before retry ${retryCount}/${maxRetries}...`
        });
      }
      // Wait for 10 seconds before retrying
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

class ActionHandler {
  constructor(tabId, port) {
    this.tabId = tabId;
    this.port = port;
  }

  async handleAction(actionData) {
    const actionMap = {
      click: this.handleClick.bind(this),
      fill: this.handleFill.bind(this),
      search_google: this.handleSearchGoogle.bind(this),
      go_to_url: this.handleGoToUrl.bind(this),
      go_back: this.handleGoBack.bind(this),
      scroll_down: this.handleScrollDown.bind(this),
      scroll_up: this.handleScrollUp.bind(this),
      send_keys: this.handleSendKeys.bind(this),
      done: this.handleDone.bind(this)
    };

    const handler = actionMap[actionData.action];
    if (!handler) {
      throw new Error(`Unknown action type: ${actionData.action}`);
    }

    // Wait for action to complete and get response
    const response = await handler(actionData);
    
    // Wait for page to stabilize after action
    await waitForPageLoad(this.tabId);
    
    // Additional delay to ensure animations complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return response;
  }

  async handleClick({ index }) {
    sendDebugMessage(this.port, `Clicking element at index ${index}`);
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(this.tabId, {
        type: "PERFORM_CLICK",
        index
      }, response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  async handleFill({ index, value }) {
    sendDebugMessage(this.port, `Filling form field at index ${index}`);
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(this.tabId, {
        type: "PERFORM_FILL",
        index,
        value
      }, response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  async handleSearchGoogle({ query }) {
    sendDebugMessage(this.port, `Searching Google for query: ${query}`);
    await chrome.tabs.sendMessage(this.tabId, {
      type: "SEARCH_GOOGLE",
      query
    });
  }

  async handleGoToUrl({ url }) {
    sendDebugMessage(this.port, `Navigating to URL: ${url}`);
    await chrome.tabs.sendMessage(this.tabId, {
      type: "GO_TO_URL",
      url
    });
  }

  async handleGoBack() {
    sendDebugMessage(this.port, `Going back in history`);
    await chrome.tabs.sendMessage(this.tabId, {
      type: "GO_BACK"
    });
  }

  async handleScrollDown({ amount }) {
    sendDebugMessage(this.port, `Scrolling down ${amount} pixels`);
    await chrome.tabs.sendMessage(this.tabId, {
      type: "SCROLL_DOWN",
      amount
    });
  }

  async handleScrollUp({ amount }) {
    sendDebugMessage(this.port, `Scrolling up ${amount} pixels`);
    await chrome.tabs.sendMessage(this.tabId, {
      type: "SCROLL_UP",
      amount
    });
  }

  async handleSendKeys({ keys }) {
    sendDebugMessage(this.port, `Sending keys: ${keys}`);
    await chrome.tabs.sendMessage(this.tabId, {
      type: "SEND_KEYS",
      keys
    });
  }

  async handleDone({ description }) {
    sendDebugMessage(this.port, `Task completed: ${description}`);
    return { success: true, isDone: true };
  }
}

async function getInteractiveElements(tabId) {
  try {
    console.log('Requesting interactive elements from content script');
    const response = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_MARKUP", highlightElements: false });
    
    if (!response.success) {
      console.error('Failed to get interactive elements:', response.error);
      throw new Error(response.error || 'Failed to get interactive elements');
    }
    
    return response.stringifiedInteractiveElements;
  } catch (error) {
    console.error('Failed to get page data:', error);
    throw new Error('Failed to analyze page structure: ' + error.message);
  }
}

// Helper function to initialize cursor with retries
async function initializeCursorWithRetry(tabId, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "INIT_CURSOR" });
      return;
    } catch (error) {
      console.warn(`Cursor initialization attempt ${attempt + 1} failed:`, error);
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

