// Import storage service
import { conversationStorage } from './storage.js';

// Store active connections
const ports = new Map();

// Track active window for each port
const portWindows = new Map();

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
  const taskExecutor = new TaskExecutor(tabId, port);
  
  try {
    // Execute the task using the three-step process
    const result = await taskExecutor.execute(prompt);
    
    if (result.success) {
      sendSidebarMessage(port, `Task completed successfully`);
      return { success: true, response: result.response };
    } else {
      // If task failed and we haven't exceeded retry limit
      if (retryCounter < 5) {
        sendDebugMessage(port, `Retrying task (attempt ${retryCounter + 1})`);
        return promptAI(prompt, tabId, port, stepCounter, retryCounter + 1);
      } else {
        sendSidebarMessage(port, `Task failed after ${retryCounter} attempts`);
        return { success: false, error: "Max retries exceeded" };
      }
    }
  } catch (error) {
    console.error('Error executing task:', error);
    return { success: false, error: error.message };
  }
}

// Function to update session state in tab
async function updateTabSessionState(tabId, state) {
  try {
    await chrome.tabs.sendMessage(tabId, { 
      type: "SESSION_STATE", 
      state: state 
    });
  } catch (error) {
    console.warn('Failed to update tab session state:', error);
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
    
    // Get and store the current window ID for this port
    chrome.windows.getCurrent().then(window => {
      portWindows.set(portId, window.id);
      // Set active state for current tab
      chrome.tabs.query({ active: true, windowId: window.id }, async ([tab]) => {
        if (tab) {
          await updateTabSessionState(tab.id, "active");
        }
      });
    });
    
    port.onDisconnect.addListener(async () => {
      const windowId = portWindows.get(portId);
      ports.delete(portId);
      portWindows.delete(portId);
      console.log(`Port disconnected: ${portId}`);
      
      // Get the current active tab in the same window
      try {
        const [tab] = await chrome.tabs.query({ active: true, windowId });
        if (tab) {
          // Update session state and clean up extension markup
          await updateTabSessionState(tab.id, "inactive");
          await cleanupExtensionMarkup(tab.id);
        }
      } catch (error) {
        console.error("Error during cleanup on disconnect:", error);
      }
    });

    // Initialize cursor when sidebar connects
    chrome.windows.getCurrent().then(window => {
      chrome.tabs.query({ active: true, windowId: window.id }, async ([tab]) => {
        if (tab) {
          try {
            await initializeCursorWithRetry(tab.id);
          } catch (error) {
            console.warn('Failed to initialize cursor:', error);
          }
        }
      });
    });

    // Listen for tab updates to reinitialize cursor when needed
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      // Only handle tabs in the window where this sidebar is open
      const windowId = portWindows.get(portId);
      if (tab.windowId === windowId && changeInfo.status === 'complete') {
        try {
          // Wait a bit for the page to stabilize
          await new Promise(resolve => setTimeout(resolve, 500));
          await initializeCursorWithRetry(tabId);
          // Update session state for the new page
          await updateTabSessionState(tabId, "active");
        } catch (error) {
          console.warn('Failed to reinitialize cursor on tab update:', error);
        }
      }
    });

    port.onMessage.addListener(async (message) => {
      console.log('Received message in background:', message);
      if (message.type === "PROMPT_AI") {
        // Get the window ID for this port
        const portId = Array.from(ports.entries()).find(([id, p]) => p === port)?.[0];
        const windowId = portWindows.get(portId);
        
        // Get the active tab in the correct window
        const [tab] = await chrome.tabs.query({ active: true, windowId });
        if (!tab) {
          port.postMessage({
            type: "AI_RESPONSE",
            success: false,
            error: "No active tab found in the current window"
          });
          return;
        }

        const result = await promptAI(
          message.prompt,
          tab.id,
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
        // Get the window ID for this port
        const portId = Array.from(ports.entries()).find(([id, p]) => p === port)?.[0];
        const windowId = portWindows.get(portId);
        
        // Get the active tab in the correct window
        const [tab] = await chrome.tabs.query({ active: true, windowId });
        if (tab) {
          await updateTabSessionState(tab.id, "inactive");
        }
        await resetSession(port, tab?.id);
        if (tab) {
          await updateTabSessionState(tab.id, "active");
        }
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
async function sendPromptAndScreenshotToServer(prompt, base64Screenshot, stringifiedInteractiveElements = null, promptType = "executor", taskId = null, planStepId = null) {
  console.log('Starting AI service request with prompt:', prompt, 'type:', promptType);
  
  // Get provider and settings from storage
  const { provider } = await chrome.storage.local.get({ provider: 'openai' });

  // Add conversation entry with task and plan step references
  await conversationStorage.addConversationEntry(
    { 
      role: 'user', 
      content: prompt, 
      elements: stringifiedInteractiveElements, 
      screenshot: base64Screenshot 
    },
    taskId,
    planStepId,
    promptType
  );

  let response;
  try {
    if (provider === 'openai') {
      response = await sendToOpenAI(promptType, taskId, planStepId);
      console.log('OpenAI Response:', response);
    } else if (provider === 'ollama') {
      response = await sendToOllama(promptType, taskId, planStepId);
      console.log('Ollama Response:', response);
    } else {
      response = await sendToGemini(promptType, taskId, planStepId);
      console.log('Gemini Response:', response);
    }

    // Add AI response to conversation history
    if (response.success) {
      await conversationStorage.addConversationEntry(
        { 
          role: 'assistant', 
          content: response.response 
        },
        taskId,
        planStepId,
        promptType
      );
    }
  } catch (error) {
    console.error('AI service error:', error);
    throw error;
  }

  return response;
}

// Get the appropriate schema based on prompt type
function getSchemaForPromptType(promptType) {
  switch (promptType) {
    case "planner":
      return {
        type: "object",
        properties: {
          action_plan: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["browser_action", "checkpoint"]
                },
                description: {
                  type: "string"
                },
                success_criteria: {
                  type: "string"
                },
                confidence_level: {
                  type: "number"
                }
              },
              required: ["type", "description", "success_criteria", "confidence_level"]
            }
          }
        },
        required: ["action_plan"]
      };
    case "evaluator":
      return {
        type: "object",
        properties: {
          evaluation: {
            type: "string",
            enum: ["success", "failure"]
          },
          reason: {
            type: "string"
          },
          confidence: {
            type: "number"
          }
        },
        required: ["evaluation", "reason", "confidence"]
      };
    default:
      return BROWSER_AUTOMATION_SCHEMA;
  }
}

// Get the appropriate system prompt based on type
async function getSystemPromptForType(promptType) {
  const { system_prompt } = await chrome.storage.local.get({ system_prompt: "" });
  
  switch (promptType) {
    case "planner":
      return await fetch(chrome.runtime.getURL("prompts/planner/prompt.txt")).then(r => r.text());
    case "evaluator":
      return await fetch(chrome.runtime.getURL("prompts/evaluator/prompt.txt")).then(r => r.text());
    default:
      return system_prompt;
  }
}

// Update the OpenAI schema
async function sendToOpenAI(promptType = "executor", taskId = null, planStepId = null) {
  // Get provider and settings from storage
  const { openai_api_key, openai_model } = await chrome.storage.local.get({
    openai_api_key: "",
    openai_model: "gpt-4o-min"
  });

  console.log("Preparing OpenAI request");
  if (!openai_api_key) {
    throw new Error(
      "OpenAI API key not set. Please set your API key in the extension options."
    );
  }

  // Get filtered conversation history
  const aiHistory = await conversationStorage.getFilteredHistory(taskId, planStepId, promptType);
  console.log("AI History:", aiHistory); // Log the history for debugging

  // get the last message from the history
  const lastMessage = aiHistory[aiHistory.length - 1];
  if (!lastMessage || !lastMessage.content) {
    throw new Error("Last message content is null or undefined");
  }

  // loop through the history messages except for the last one and add them to the messages array
  let messages = []
  aiHistory.slice(0, -1).map((message) => {
    if (promptType != "executor" && message.role === "assistant") {
      messages.push({
        role: message.role,
        content: {
          type: "text",
          text: message.content || "",
        },
      });
    }
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

  console.log("Messages to send:", messages); // Log the messages for debugging

  const OPENAI_API_ENDPOINT = "https://api.openai.com/v1/chat/completions";
  const requestBody = {
    model: openai_model,
    messages: [
      {
        role: "system",
        content: await getSystemPromptForType(promptType),
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
        schema: getSchemaForPromptType(promptType),
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
async function sendToOllama(promptType = "executor", taskId = null, planStepId = null) {
  const { ollama_model } = await chrome.storage.local.get({
    ollama_model: "llama3.2-vision"
  });

  console.log("Preparing Ollama request");

  // Get filtered conversation history
  const aiHistory = await conversationStorage.getFilteredHistory(taskId, planStepId, promptType);
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
        content: await getSystemPromptForType(promptType),
      },
      ...messages,
    ],
    max_tokens: 1000,
    response_format: {
      type: "json_schema",
      schema: getSchemaForPromptType(promptType),
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
async function sendToGemini(promptType = "executor", taskId = null, planStepId = null) {
  const {
    gemini_api_key,
    gemini_model,
  } = await chrome.storage.local.get({
    gemini_api_key: "",
    gemini_model: "gemini-2.0-flash-exp",
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

      // Get filtered conversation history
      const aiHistory = await conversationStorage.getFilteredHistory(taskId, planStepId, promptType);
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
            text: await getSystemPromptForType(promptType)
          }
        },
        contents: [messages],
        generationConfig: {
          temperature: 0.4,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
          responseSchema: getSchemaForPromptType(promptType)
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

class TaskExecutor {
  constructor(tabId, port) {
    this.tabId = tabId;
    this.port = port;
    this.actionHandler = new ActionHandler(tabId, port);
    this.screenshotManager = new ScreenshotManager();
    this.maxSteps = 10;
    this.maxRetries = 5;
    this.currentTaskId = null;
    this.currentPlanStepId = null;
  }

  async execute(prompt) {
    await this.screenshotManager.initialize();
    let stepCounter = 0;
    
    try {
      // Create a new task
      this.currentTaskId = await conversationStorage.createTask(prompt);
      console.log("Created task with ID:", this.currentTaskId);
      
      // Step 1: Planning - Get high-level plan
      const plan = await this.planTask(prompt);
      console.log("Generated plan:", plan);
      
      // Execute the plan
      for (const planStep of plan.action_plan) {
        // Create a plan step record
        this.currentPlanStepId = await conversationStorage.createPlanStep(
          this.currentTaskId,
          planStep.description,
          planStep.type
        );
        console.log("Created plan step with ID:", this.currentPlanStepId);
        
        if (planStep.type === "checkpoint") {
          // Get fresh state and continue planning
          const newState = await this.getCurrentState();
          // TODO: Handle checkpoint logic
          break;
        }
        
        // Step 2: Execute browser actions for this plan step
        const result = await this.executeBrowserActions(planStep.description, stepCounter);
        if (!result.success) {
          return result;
        }

        // Step 3: Evaluate this plan step
        const evaluation = await this.evaluatePlanStep(planStep);
        console.log("Plan step evaluation:", evaluation);
        if (evaluation.evaluation !== "success") {
          return { success: false, response: evaluation };
        }
        
        stepCounter++;
        if (stepCounter >= this.maxSteps) {
          console.warn('Max steps reached');
          return { success: false, error: 'Max steps reached' };
        }
      }
      
      return { success: true, response: "All plan steps completed successfully" };
    } catch (error) {
      console.error("Task execution failed:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async executeBrowserActions(goal, stepCounter) {
    try {
      // Get current state
      const state = await this.getCurrentState();
      
      // Get browser actions using existing executor logic
      const response = await this.callAIService(goal, state, "executor");
      console.log("Browser actions response:", response);
      
      if (response.success) {
        const responseData = JSON.parse(response.response);
        
        console.log("Parsed response data:", responseData);
        
        const state = responseData.current_state;
        // Send progress updates
        if (stepCounter > 0) {
          sendSidebarMessage(this.port, `Step ${stepCounter-1} Evaluation: ${state.evaluation_previous_goal}`);
          sendSidebarMessage(this.port, `Step ${stepCounter}: ${state.next_goal}, actions: ${responseData.actions.length}`);
        } else {
          sendSidebarMessage(this.port, `Task started: ${goal}`);
        }
        
        // Check for done action first
        const doneAction = responseData.actions.find(action => action.action === 'done');
        if (doneAction) {
          sendSidebarMessage(this.port, `Task completed: ${doneAction.description}`);
          return { success: true, response, isDone: true };
        }
        
        // Execute actions sequentially with proper waiting
        for (const actionData of responseData.actions) {
          sendSidebarMessage(
            this.port,
            `Action ${responseData.actions.indexOf(actionData)+1}/${responseData.actions.length}: ${actionData.description}`
          );
          
          try {
            await this.actionHandler.handleAction(actionData);
          } catch (error) {
            console.error('Action failed:', error);
            throw error;
          }
          
          // Wait for stability
          await waitForPageLoad(this.tabId);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        return { success: true, response };
      }
      
      return { success: false, error: "Failed to get valid response from AI service" };
    } catch (error) {
      console.error('Error executing browser actions:', error);
      return { success: false, error: error.message };
    }
  }

  async planTask(prompt) {
    // Get current state
    const state = await this.getCurrentState();
    
    // Send to AI service with planner prompt
    const response = await this.callAIService(prompt, state, "planner");
    return JSON.parse(response.response);
  }

  async evaluatePlanStep(planStep) {
    // Get fresh state
    const state = await this.getCurrentState();
    
    // Format the input according to the example format using plan step details
    const formattedInput = `<interactive-elements>${state.elements}</interactive-elements>
<task>${planStep.description}</task>
<success-criteria>
${planStep.success_criteria}
</success-criteria>`;
    
    // Send to AI service with evaluator prompt
    const response = await this.callAIService(formattedInput, state, "evaluator");
    return JSON.parse(response.response);
  }

  async getCurrentState() {
    const stringifiedInteractiveElements = await getInteractiveElements(this.tabId);
    const screenshotUrl = await this.screenshotManager.captureScreenshot(this.tabId);
    await this.screenshotManager.sendDebugScreenshot(this.tabId, this.port, screenshotUrl);
    
    return {
      elements: stringifiedInteractiveElements,
      screenshot: screenshotUrl
    };
  }

  async callAIService(prompt, state, promptType) {
    // Call AI service with appropriate prompt based on type
    return await sendPromptAndScreenshotToServer(
      prompt,
      state.screenshot,
      state.elements,
      promptType,
      this.currentTaskId,
      this.currentPlanStepId
    );
  }
}

