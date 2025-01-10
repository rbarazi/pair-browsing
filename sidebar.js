// sidebar.js

const sendBtn = document.getElementById("sendBtn");
const promptInput = document.getElementById("prompt");
const messagesDiv = document.getElementById("messages");

let port = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

// Function to establish connection
function connectToBackground() {
  try {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      debugLog('Max reconnection attempts reached');
      return false;
    }

    port = chrome.runtime.connect({ name: "sidebar" });
    debugLog('Connected to background script');
    
    // Handle responses from the background script
    port.onMessage.addListener((message) => {
      debugLog('Received message in sidebar: ' + JSON.stringify(message));
      handlePortMessage(message);
    });
    
    // Handle disconnection
    port.onDisconnect.addListener(() => {
      debugLog('Port disconnected, will reconnect on next action');
      port = null;
      reconnectAttempts = 0; // Reset attempts on clean disconnect
    });
    
    return true;
  } catch (error) {
    debugLog('Failed to connect to background: ' + error.message);
    reconnectAttempts++;
    return false;
  }
}

// Ensure connection exists with retry logic
async function ensureConnection() {
  if (!port) {
    // Try to connect
    if (!connectToBackground()) {
      // If connection fails, wait and retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      return connectToBackground();
    }
  }
  return true;
}

// Function to display a message in the chat
function addMessage(text, isUser = false) {
  const msgEl = document.createElement("div");
  msgEl.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;
  
  const contentEl = document.createElement("div");
  contentEl.className = "message-content";
  contentEl.textContent = text;
  
  msgEl.appendChild(contentEl);
  messagesDiv.appendChild(msgEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Function to log debug messages if debug mode is enabled
async function debugLog(message) {
  const { debug_mode } = await chrome.storage.local.get({ debug_mode: false });
  if (debug_mode) {
    console.log(message);
    // addMessage(message, true);
  }
}

// Handle messages from background
function handlePortMessage(message) {
  if (message.type === "ASSISTANT_MESSAGE") {
    addMessage(message.message, false);
  } else if (message.type === "DEBUG_SCREENSHOT") {
    addDebugScreenshot(message.imageUri);
  } else if (message.type === "AI_RESPONSE") {
    if (!message.success) {
      addMessage(`Error: ${message.error || 'Unknown error occurred'}`);
      return;
    }

    try {
      // Parse the AI response
      const clickData = JSON.parse(message.serverResponse.response);
      displayAIResponse(clickData);
    } catch (error) {
      addMessage(`Error: ${error.message}`);
    }
  }
}

// Handle button click with retry logic
sendBtn.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  addMessage(prompt, true);

  for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
    try {
      // Get the current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('No active tab found');
      }
      
      // Ensure we have a connection
      if (!await ensureConnection()) {
        throw new Error('Failed to establish connection to background script');
      }
      
      // Send message through the port
      port.postMessage({
        type: "PROMPT_AI",
        prompt,
        tabId: tab.id
      });
      
      promptInput.value = ''; // Clear input after successful send
      return;
    } catch (error) {
      if (attempt === MAX_RECONNECT_ATTEMPTS - 1) {
        addMessage(`Error: Failed to send request after ${MAX_RECONNECT_ATTEMPTS} attempts`);
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
});

// Function to display debug screenshot
function addDebugScreenshot(imageUri) {
  debugLog('Adding debug screenshot to sidebar');
  
  // Create message container with same styling as chat messages
  const msgEl = document.createElement("div");
  msgEl.className = "message assistant-message";
  
  // Create content container
  const contentEl = document.createElement("div");
  contentEl.className = "message-content";
  
  // Add label
  const label = document.createElement("div");
  label.textContent = "Debug: Captured Screenshot";
  label.style.marginBottom = "8px";
  label.style.color = "#666";
  label.style.fontSize = "12px";
  
  // Style the image
  const img = document.createElement("img");
  img.src = imageUri;
  img.className = "debug-screenshot";
  img.style.display = "block";
  
  // Assemble the message
  contentEl.appendChild(label);
  contentEl.appendChild(img);
  msgEl.appendChild(contentEl);
  messagesDiv.appendChild(msgEl);
  
  // Scroll to the new message
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Parse and display AI response
function displayAIResponse(clickData) {
  // Display the main action description
  addMessage(`Assistant: ${clickData.description}`);

  // Display additional details based on action type
  switch (clickData.action) {
    case "click":
      addMessage(`Action: Clicking element at index ${clickData.index}`);
      break;
    case "fill":
      addMessage(`Action: Filling form field at index ${clickData.index} with "${clickData.value}"`);
      break;
    case "fill_and_submit":
      addMessage(`Action: Filling form field at index ${clickData.index} with "${clickData.value}" and submitting`);
      break;
    case "search_google":
      addMessage(`Action: Searching Google for "${clickData.query}"`);
      break;
    case "go_to_url":
      addMessage(`Action: Navigating to ${clickData.url}`);
      break;
    case "go_back":
      addMessage(`Action: Going back to previous page`);
      break;
    case "scroll_down":
    case "scroll_up":
      const direction = clickData.action === "scroll_down" ? "down" : "up";
      const amount = clickData.amount ? `${clickData.amount}px` : "one page";
      addMessage(`Action: Scrolling ${direction} ${amount}`);
      break;
    case "send_keys":
      addMessage(`Action: Sending keys "${clickData.keys}"`);
      break;
    case "extract_content":
      addMessage(`Action: Extracting content in ${clickData.format} format`);
      break;
  }

  // If there's a next action planned, show it
  if (clickData.next_prompt) {
    addMessage(`Next action: ${clickData.next_prompt}`);
  }
}

// Add keyboard shortcut handling
promptInput.addEventListener("keydown", async (e) => {
  // Check for Command+Enter (Mac) or Control+Enter (Windows)
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    const prompt = promptInput.value.trim();
    if (prompt) {
      sendBtn.click();
    }
  }
});

// Initialize connection when the script loads
connectToBackground();
