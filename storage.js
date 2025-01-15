// IndexedDB storage service for conversation history
class ConversationStorage {
  constructor() {
    this.DB_NAME = 'conversationDB';
    this.STORE_NAME = 'conversations';
    this.VERSION = 1;
    this.db = null;
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
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'timestamp' });
        }
      };
    });
  }

  async clearHistory() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('Conversation history cleared');
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to clear history');
        reject(request.error);
      };
    });
  }

  async addEntry(entry) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const enhancedEntry = {
        ...entry,
        timestamp: Date.now()
      };
      const request = store.add(enhancedEntry);

      request.onsuccess = () => {
        console.log('Entry added to history');
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to add entry');
        reject(request.error);
      };
    });
  }

  async getAllHistory() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort by timestamp and remove timestamp from returned objects
        const history = request.result
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(({ timestamp, ...entry }) => entry);
        resolve(history);
      };

      request.onerror = () => {
        console.error('Failed to get history');
        reject(request.error);
      };
    });
  }
}

// Export singleton instance
export const conversationStorage = new ConversationStorage(); 