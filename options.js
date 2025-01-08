// Saves options to chrome.storage
function saveOptions() {
  const provider = document.getElementById('provider').value;
  const openaiKey = document.getElementById('openaiKey').value;
  const openaiModel = document.getElementById('openaiModel').value || 'gpt-4o-mini';
  const geminiKey = document.getElementById('geminiKey').value;
  const geminiModel = document.getElementById('geminiModel').value || 'gemini-2.0-flash-exp';
  const systemPrompt = document.getElementById('systemPrompt').value || 
    'You are a visual assistant that helps users navigate web pages by providing precise click coordinates. Your task is to:\n\n' +
    '1. Analyze the screenshot carefully to find the exact element the user wants to interact with\n' +
    '2. Return the precise pixel coordinates (x, y) of the CENTER of the target element\n' +
    '3. Ensure coordinates are relative to the visible viewport (not the full page)\n' +
    '4. Provide coordinates that would result in a successful click (avoid edges/borders of elements)\n' +
    '5. Include a clear description of what exactly will be clicked\n\n' +
    'Remember: Accuracy is crucial - the coordinates must point to the exact clickable area of the element.';
  const debugMode = document.getElementById('debugMode').checked;
  const agentMode = document.getElementById('agentMode').checked;

  chrome.storage.local.set(
    {
      provider,
      openai_api_key: openaiKey,
      openai_model: openaiModel,
      gemini_api_key: geminiKey,
      gemini_model: geminiModel,
      system_prompt: systemPrompt,
      debug_mode: debugMode,
      agent_mode: agentMode,
    },
    () => {
      const status = document.getElementById('status');
      status.textContent = 'Options saved.';
      status.style.display = 'block';
      status.className = 'success';
      setTimeout(() => {
        status.style.display = 'none';
      }, 2000);
    }
  );
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restoreOptions() {
  chrome.storage.local.get(
    {
      provider: 'openai',
      openai_api_key: '',
      openai_model: 'gpt-4o-mini',
      gemini_api_key: '',
      gemini_model: 'gemini-2.0-flash-exp',
      system_prompt: `You are a browser automation agent that helps users navigate and interact with web pages. Your available actions are:

1. Click: Click on interactive elements
2. Fill: Input text into form fields
3. Search Google: Search Google in the current tab
4. Navigate: Go to URLs or go back in history
5. Scroll: Scroll the page up or down
6. Send Keys: Send keyboard inputs to the active element
7. Extract Content: Get page content as text or markdown

For each request, analyze the webpage elements and determine the appropriate action. Respond with a JSON object containing:
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
}`,
      debug_mode: false,
      agent_mode: false,
    },
    (items) => {
      document.getElementById('provider').value = items.provider;
      document.getElementById('openaiKey').value = items.openai_api_key;
      document.getElementById('openaiModel').value = items.openai_model;
      document.getElementById('geminiKey').value = items.gemini_api_key;
      document.getElementById('geminiModel').value = items.gemini_model;
      document.getElementById('systemPrompt').value = items.system_prompt;
      document.getElementById('debugMode').checked = items.debug_mode;
      document.getElementById('agentMode').checked = items.agent_mode;
      updateVisibility();
    }
  );
}

// Show/hide provider sections based on selection
function updateVisibility() {
  const provider = document.getElementById('provider').value;
  document.getElementById('openai-section').style.display = provider === 'openai' ? 'block' : 'none';
  document.getElementById('gemini-section').style.display = provider === 'gemini' ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('provider').addEventListener('change', updateVisibility); 