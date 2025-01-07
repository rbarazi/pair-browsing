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
    addMessage(message, true);
  }
}

// Handle messages from background
function handlePortMessage(message) {
  if (message.type === "AI_RESPONSE") {
    if (!message.success) {
      addMessage(`Error: ${message.error || 'Unknown error occurred'}`);
      return;
    }

    try {
      // Parse the AI response
      const clickData = JSON.parse(message.serverResponse.response);
      displayAIResponse(clickData);
      
      // Remove the redundant click message - the background script already handles this
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
        type: "CAPTURE_SCREENSHOT",
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
  const msgEl = document.createElement("div");
  msgEl.style.margin = "10px 0";
  
  const img = document.createElement("img");
  img.src = imageUri;
  img.style.maxWidth = "100%";
  img.style.border = "1px solid #ccc";
  img.style.borderRadius = "4px";
  
  const label = document.createElement("div");
  label.textContent = "Debug: Captured Screenshot";
  label.style.color = "#666";
  label.style.fontSize = "12px";
  label.style.marginBottom = "5px";
  
  msgEl.appendChild(label);
  msgEl.appendChild(img);
  messagesDiv.appendChild(msgEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Parse and display AI response
function displayAIResponse(clickData) {
  addMessage(`Assistant: ${clickData.description}`);
  if (typeof clickData.index === 'number') {
    addMessage(`Selected element index: ${clickData.index}`);
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
