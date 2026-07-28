// =============================================================================
// Local Scam Database — IndexedDB-backed cache
// Stores hashes of known scam texts/URLs for instant lookup without AI tokens
// =============================================================================

interface ScamRecord {
  hash: string;
  verdict: 'SOSPECHOSO' | 'PELIGROSO';
  riskScore: number;
  tactics: string[];
  source: string;
  timestamp: number;
}

interface ScamDBLookupResult {
  found: boolean;
  record?: ScamRecord;
}

const DB_NAME = 'nada-scam-db';
const DB_VERSION = 1;
const STORE_NAME = 'scam-hashes';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class ScamDatabase {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<boolean> | null = null;

  async init(): Promise<boolean> {
    if (this.db) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<boolean>((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          resolve(true);
        };

        request.onerror = () => {
          console.warn('[NADA][ScamDB] Failed to open IndexedDB');
          resolve(false);
        };
      } catch {
        resolve(false);
      }
    });

    return this.initPromise;
  }

  // Generate a fast hash for text content
  async hashText(text: string): Promise<string> {
    // Normalize: lowercase, trim, remove excess whitespace
    const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');

    // Use SubtleCrypto if available, otherwise simple hash
    if (crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(normalized);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback: simple FNV-1a hash
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  // Look up text in the scam database
  async lookup(text: string): Promise<ScamDBLookupResult> {
    if (!await this.init()) return { found: false };
    if (!this.db) return { found: false };

    const hash = await this.hashText(text);

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(hash);

        request.onsuccess = () => {
          const record = request.result as ScamRecord | undefined;
          if (record) {
            // Check if record is still fresh
            if (Date.now() - record.timestamp < MAX_AGE_MS) {
              resolve({ found: true, record });
            } else {
              // Expired, will be cleaned up
              resolve({ found: false });
            }
          } else {
            resolve({ found: false });
          }
        };

        request.onerror = () => resolve({ found: false });
      } catch {
        resolve({ found: false });
      }
    });
  }

  // Store a scam result for future instant lookups
  async store(text: string, verdict: 'SOSPECHOSO' | 'PELIGROSO', riskScore: number, tactics: string[], source: string): Promise<void> {
    if (!await this.init()) return;
    if (!this.db) return;

    const hash = await this.hashText(text);
    const record: ScamRecord = {
      hash,
      verdict,
      riskScore,
      tactics,
      source,
      timestamp: Date.now(),
    };

    try {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
    } catch {
      // IndexedDB write failed silently
    }
  }

  // Get count of stored records
  async getCount(): Promise<number> {
    if (!await this.init()) return 0;
    if (!this.db) return 0;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  }

  // Cleanup expired records
  async cleanup(): Promise<void> {
    if (!await this.init()) return;
    if (!this.db) return;

    const cutoff = Date.now() - MAX_AGE_MS;

    try {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    } catch {
      // Cleanup failed silently
    }
  }
}

export const scamDatabase = new ScamDatabase();
