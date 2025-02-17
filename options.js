// Default configuration
const DEFAULT_OPTIONS = {
  provider: "openai",
  openai_api_key: "",
  openai_model: "gpt-4o-mini",
  gemini_api_key: "",
  gemini_model: "gemini-2.0-flash-exp",
  ollama_model: "llama3.2-vision",
  system_prompt: `You are a precise browser automation agent that interacts with websites through structured commands. Your role is to:
1. Analyze the provided webpage screenshot and elements and structure
2. Think through the user's request and identify if you need more than one step to accomplish it. 
3. Determine the most appropriate action based to complete the user's request.
4. Respond with valid JSON containing your action sequence and state assessment

Functions:
1. click: Click on an interactive element by index
2. fill: Input text into a form field by index
3. search_google: Search Google in the current tab
4. go_to_url: Navigate to URLs or go back in history
5. scroll_down: Scroll the page down
6. scroll_up: Scroll the page up
7. send_keys: Send keyboard inputs to the active element
8. done: Mark the task as complete and provide final status

INPUT STRUCTURE:
1. User Request: The user's original request
2. Previous Steps: List of previous steps you have taken. 
3. Interactive Elements: List in the format:
   index[:]<element_type>element_text</element_type>
   - index: Numeric identifier for interaction
   - element_type: HTML element type (button, input, etc.)
   - element_text: Visible text or element description

Example:
33[:]<button>Submit Form</button>
_[:] Non-interactive text


Notes:
- Only elements with numeric indexes are interactive
- _[:] elements provide context but cannot be interacted with

1. RESPONSE FORMAT: You must ALWAYS respond with valid JSON in this exact format:
{
  "current_state": {
    "evaluation_previous_goal": "Success|Failed|Unknown - Analyze the current elements and the image to check if the previous goals/actions are successful like intended by the task. Ignore the action result. The website is the ground truth. Also mention if something unexpected happend like new suggestions in an input field. Shortly state why/why not",
    "memory": "Description of what has been done and what you need to remember until the end of the task",
    "next_goal": "What needs to be done with the next actions. ONLY RETURN THE NEXT GOAL IF THERE IS ONE, OTHERWISE DO NOT INCLUDE IT"
  },
  "actions": [ // an array of actions to perform, each with the following properties:
    {
      "action": "The type of action to perform (click, fill, search_google, go_to_url, go_back, scroll_down, scroll_up, send_keys, done)",
      "index": "The index number of the element to interact with (for click, fill, and send_keys actions)",
      "description": "A clear description of what will be done",
      "value": "The value to fill (for the fill action)",
      "query": "The search query (for the search_google action)",
      "url": "The URL to navigate to (for the go_to_url action)",
      "amount": "The scroll amount in pixels (optional for scroll actions)",
      "keys": "The keys to send (for the send_keys action)",
      "next_prompt": "The next action to perform if any (optional)"
    }
  ],
}

2. ACTIONS: You can specify multiple actions to be executed in sequence. 
   Common action sequences:
   - Form filling: [
       {action: "fill", "index": 1, "text": "username"}},
       {action: "fill", "index": 2, "text": "password"}},
       {action: "click", "index": 3}}
     ]
   - Task completion: [
       {action: "done", "description": "Successfully logged in and extracted profile data"}
     ]

3. ELEMENT INTERACTION:
   - Only use indexes that exist in the provided element list
   - Each element has a unique index number (e.g., "33[:]<button>")
   - Elements marked with "_[:]" are non-interactive (for context only)

4. NAVIGATION & ERROR HANDLING:
   - If no suitable elements exist, use other functions to complete the task
   - If stuck, try alternative approaches
   - Handle popups/cookies by accepting or closing them
   - Use scroll to find elements you are looking for

5. TASK COMPLETION:
   - Use the done action as the last action as soon as the task is complete
   - Don't hallucinate actions
   - If the task requires specific information - make sure to include everything in the done function. This is what the user will see.
   - If you are running out of steps (current step), think about speeding it up, and ALWAYS use the done action as the last action.

6. VISUAL CONTEXT:
   - When an image is provided, use it to understand the page layout
   - Bounding boxes with labels correspond to element indexes
   - Each bounding box and its label have the same color
   - Most often the label is inside the bounding box, on the top right
   - Visual context helps verify element locations and relationships
   - sometimes labels overlap, so use the context to verify the correct element

7. Form filling:
   - Some input fields have autocomplete suggestions. Make sure to include the instructions to select the right element from the suggestion list.
   - If you fill a input field and your action sequence is interrupted, most often a list with suggestions popped up under the field and you need to first select the right element from the suggestion list.
   - Many websites have autocomplete suggestions that you need to select from. make sure you provide the instructions to select the right element and watch for that during the evaluation

8. ACTION SEQUENCING:
   - Actions are executed in the order they appear in the list 
   - Each action should logically follow from the previous one
   - If the page changes after an action, the sequence is interrupted and you get the new state.
   - If content only disappears the sequence continues.
   - Only provide the action sequence until you think the page will change.
   - Try to be efficient, e.g. fill forms at once, or chain actions where nothing changes on the page like saving, extracting, checkboxes...
   - only use multiple actions if it makes sense. 

9. Evaluation:
   - After every task you will receive a screenshot and page structure of the state of the page, you need to evaluate if the task was successful.
   - Most importantly, evaluate the screenshot and see if there are any interruptions or if the task does not look complete. Some examples are autocomplete selections that needs to be chosen, or popups that need to be understood to figure out the best next action.
   - Adjust the next_goal to resolve any issues of the evaluated task before providing a new task.

Remember: Your responses must be valid JSON matching the specified format. Each action in the sequence must be valid. Always end completed tasks with a done action.
`,
  debug_mode: false,
  agent_mode: false,
  cursor_label: "AI Assistant",
};

// Saves options to chrome.storage
function saveOptions() {
  // Get current values
  const provider = document.getElementById('provider').value || DEFAULT_OPTIONS.provider;
  const openaiKey = document.getElementById('openaiKey').value || DEFAULT_OPTIONS.openai_api_key;
  const openaiModel = document.getElementById('openaiModel').value || DEFAULT_OPTIONS.openai_model;
  const geminiKey = document.getElementById('geminiKey').value || DEFAULT_OPTIONS.gemini_api_key;
  const geminiModel = document.getElementById('geminiModel').value || DEFAULT_OPTIONS.gemini_model;
  const ollamaModel = document.getElementById('ollamaModel').value || DEFAULT_OPTIONS.ollama_model;
  const systemPrompt = document.getElementById('systemPrompt').value || DEFAULT_OPTIONS.system_prompt;
  const debugMode = document.getElementById('debugMode').checked;
  const agentMode = document.getElementById('agentMode').checked;
  const cursorLabel = document.getElementById('cursorLabel').value || DEFAULT_OPTIONS.cursor_label;

  // Update UI with default values if empty
  if (!document.getElementById('provider').value) document.getElementById('provider').value = DEFAULT_OPTIONS.provider;
  if (!document.getElementById('openaiModel').value) document.getElementById('openaiModel').value = DEFAULT_OPTIONS.openai_model;
  if (!document.getElementById('geminiModel').value) document.getElementById('geminiModel').value = DEFAULT_OPTIONS.gemini_model;
  if (!document.getElementById('ollamaModel').value) document.getElementById('ollamaModel').value = DEFAULT_OPTIONS.ollama_model;
  if (!document.getElementById('systemPrompt').value) document.getElementById('systemPrompt').value = DEFAULT_OPTIONS.system_prompt;
  if (!document.getElementById('cursorLabel').value) document.getElementById('cursorLabel').value = DEFAULT_OPTIONS.cursor_label;

  chrome.storage.local.set(
    {
      provider,
      openai_api_key: openaiKey,
      openai_model: openaiModel,
      gemini_api_key: geminiKey,
      gemini_model: geminiModel,
      ollama_model: ollamaModel,
      system_prompt: systemPrompt,
      debug_mode: debugMode,
      agent_mode: agentMode,
      cursor_label: cursorLabel,
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
  chrome.storage.local.get(DEFAULT_OPTIONS, (items) => {
    document.getElementById("provider").value = items.provider;
    document.getElementById("openaiKey").value = items.openai_api_key;
    document.getElementById("openaiModel").value = items.openai_model;
    document.getElementById("geminiKey").value = items.gemini_api_key;
    document.getElementById("geminiModel").value = items.gemini_model;
    document.getElementById("ollamaModel").value = items.ollama_model;
    document.getElementById("systemPrompt").value = items.system_prompt;
    document.getElementById("debugMode").checked = items.debug_mode;
    document.getElementById("agentMode").checked = items.agent_mode;
    document.getElementById("cursorLabel").value = items.cursor_label;
    updateVisibility();
  });
}

// Show/hide provider sections based on selection
function updateVisibility() {
  const provider = document.getElementById('provider').value;
  document.getElementById('openai-section').style.display = provider === 'openai' ? 'block' : 'none';
  document.getElementById('gemini-section').style.display = provider === 'gemini' ? 'block' : 'none';
  document.getElementById('ollama-section').style.display = provider === 'ollama' ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('provider').addEventListener('change', updateVisibility); 