import { openDB, DBSchema, IDBPDatabase } from "idb";

interface E2EEStoreDB extends DBSchema {
  keys: {
    key: string;
    value: {
      sessionId: string;
      key: CryptoKey;
      salt: Uint8Array;
      updatedAt: number;
    };
  };
}

const DB_NAME = "worksphere-e2ee-store";
const DB_VERSION = 1;
const STORE_NAME = "keys";

export class KeyStore {
  private dbPromise: Promise<IDBPDatabase<E2EEStoreDB>> | null = null;

  private getDB() {
    if (!this.dbPromise) {
      this.dbPromise = openDB<E2EEStoreDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
          }
        },
      });
    }
    return this.dbPromise;
  }

  async saveSessionKey(
    sessionId: string,
    key: CryptoKey,
    salt: Uint8Array,
  ): Promise<void> {
    const db = await this.getDB();
    await db.put(STORE_NAME, {
      sessionId,
      key,
      salt,
      updatedAt: Date.now(),
    });
  }

  async getSessionKey(
    sessionId: string,
  ): Promise<{ key: CryptoKey; salt: Uint8Array } | null> {
    const db = await this.getDB();
    const result = await db.get(STORE_NAME, sessionId);
    if (!result) return null;
    return { key: result.key, salt: result.salt };
  }

  async deleteSessionKey(sessionId: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(STORE_NAME, sessionId);
  }

  async clearAllKeys(): Promise<void> {
    const db = await this.getDB();
    await db.clear(STORE_NAME);
  }
}
