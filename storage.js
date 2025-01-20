// IndexedDB storage service for conversation history
class ConversationStorage {
  constructor() {
    this.DB_NAME = 'conversationDB';
    this.VERSION = 3; // Increment version for schema update
    this.db = null;
    
    // Store names
    this.TASKS_STORE = 'tasks';
    this.PLAN_STEPS_STORE = 'planSteps';
    this.CONVERSATIONS_STORE = 'conversations';
  }

  async init() {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.VERSION);

      request.onerror = () => {
        console.error('Failed to open database');
        reject(request.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create tasks store
        if (!db.objectStoreNames.contains(this.TASKS_STORE)) {
          const taskStore = db.createObjectStore(this.TASKS_STORE, { keyPath: 'id', autoIncrement: true });
          taskStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        // Create plan steps store
        if (!db.objectStoreNames.contains(this.PLAN_STEPS_STORE)) {
          const planStepStore = db.createObjectStore(this.PLAN_STEPS_STORE, { keyPath: 'id', autoIncrement: true });
          planStepStore.createIndex('taskId', 'taskId', { unique: false });
          planStepStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        // Create or update conversations store with string ID
        if (db.objectStoreNames.contains(this.CONVERSATIONS_STORE)) {
          db.deleteObjectStore(this.CONVERSATIONS_STORE);
        }
        const conversationStore = db.createObjectStore(this.CONVERSATIONS_STORE, { keyPath: 'id' });
        conversationStore.createIndex('timestamp', 'timestamp', { unique: false });
        conversationStore.createIndex('taskId', 'taskId', { unique: false });
        conversationStore.createIndex('planStepId', 'planStepId', { unique: false });
        conversationStore.createIndex('agentType', 'agentType', { unique: false });
      };
    });
  }

  async clearHistory() {
    await this.init();
    const stores = [this.TASKS_STORE, this.PLAN_STEPS_STORE, this.CONVERSATIONS_STORE];
    
    return Promise.all(stores.map(storeName => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => {
          console.log(`${storeName} cleared`);
          resolve();
        };

        request.onerror = () => {
          console.error(`Failed to clear ${storeName}`);
          reject(request.error);
        };
      });
    }));
  }

  async createTask(description) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.TASKS_STORE], 'readwrite');
      const store = transaction.objectStore(this.TASKS_STORE);
      
      const task = {
        description,
        timestamp: Date.now(),
        status: 'in_progress' // Can be: 'in_progress', 'completed', 'failed'
      };
      
      const request = store.add(task);
      
      request.onsuccess = () => {
        console.log('Task created with ID:', request.result);
        resolve(request.result); // Returns the task ID
      };
      
      request.onerror = () => {
        console.error('Failed to create task');
        reject(request.error);
      };
    });
  }

  async createPlanStep(taskId, description, type) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.PLAN_STEPS_STORE], 'readwrite');
      const store = transaction.objectStore(this.PLAN_STEPS_STORE);
      
      const planStep = {
        taskId,
        description,
        type, // Can be: 'browser_action' or 'checkpoint'
        timestamp: Date.now(),
        status: 'pending' // Can be: 'pending', 'in_progress', 'completed', 'failed'
      };
      
      const request = store.add(planStep);
      
      request.onsuccess = () => {
        console.log('Plan step created with ID:', request.result);
        resolve(request.result); // Returns the plan step ID
      };
      
      request.onerror = () => {
        console.error('Failed to create plan step');
        reject(request.error);
      };
    });
  }

  async addConversationEntry(entry, taskId, planStepId = null, agentType) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.CONVERSATIONS_STORE], 'readwrite');
      const store = transaction.objectStore(this.CONVERSATIONS_STORE);
      
      // Generate a unique ID using timestamp and random number
      const uniqueId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      
      const enhancedEntry = {
        id: uniqueId, // Add explicit ID
        ...entry,
        taskId,
        planStepId,
        agentType, // Can be: 'planner', 'executor', 'evaluator'
        timestamp: Date.now()
      };
      
      const request = store.add(enhancedEntry);
      
      request.onsuccess = () => {
        console.log('Conversation entry added');
        resolve(request.result);
      };
      
      request.onerror = () => {
        console.error('Failed to add conversation entry');
        reject(request.error);
      };
    });
  }

  async getTaskConversations(taskId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.CONVERSATIONS_STORE], 'readonly');
      const store = transaction.objectStore(this.CONVERSATIONS_STORE);
      const index = store.index('taskId');
      const request = index.getAll(taskId);
      
      request.onsuccess = () => {
        const conversations = request.result
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(({ id, timestamp, taskId, planStepId, agentType, ...entry }) => entry);
        resolve(conversations);
      };
      
      request.onerror = () => {
        console.error('Failed to get task conversations');
        reject(request.error);
      };
    });
  }

  async getPlanStepConversations(planStepId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.CONVERSATIONS_STORE], 'readonly');
      const store = transaction.objectStore(this.CONVERSATIONS_STORE);
      const index = store.index('planStepId');
      const request = index.getAll(planStepId);
      
      request.onsuccess = () => {
        const conversations = request.result
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(({ id, timestamp, taskId, planStepId, agentType, ...entry }) => entry);
        resolve(conversations);
      };
      
      request.onerror = () => {
        console.error('Failed to get plan step conversations');
        reject(request.error);
      };
    });
  }

  async getFilteredHistory(taskId = null, planStepId = null, agentType = null) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.CONVERSATIONS_STORE], 'readonly');
      const store = transaction.objectStore(this.CONVERSATIONS_STORE);
      const request = store.getAll();
      
      request.onsuccess = () => {
        let history = request.result;
        
        // Apply filters
        if (taskId !== null) {
          history = history.filter(entry => entry.taskId === taskId);
        }
        if (planStepId !== null) {
          history = history.filter(entry => entry.planStepId === planStepId);
        }
        if (agentType !== null) {
          history = history.filter(entry => entry.agentType === agentType);
        }
        
        // Sort and clean up metadata
        history = history
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(({ id, timestamp, taskId, planStepId, agentType, ...entry }) => entry);
          
        resolve(history);
      };
      
      request.onerror = () => {
        console.error('Failed to get filtered history');
        reject(request.error);
      };
    });
  }

  // Mark getAllHistory as deprecated
  async getAllHistory() {
    console.warn('getAllHistory is deprecated. Use getFilteredHistory instead.');
    return this.getFilteredHistory();
  }
}

// Export singleton instance
export const conversationStorage = new ConversationStorage(); 