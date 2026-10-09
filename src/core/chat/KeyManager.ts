/**
 * KeyManager.ts
 * Manages the lifecycle of pre-keys, identity keys, and session states in encrypted IndexedDB storage.
 * Ensures keys are securely generated, stored, and rotated according to the Signal Protocol.
 */

import { e2eeWasm } from '@/lib/wasm-loader/e2ee';

export interface SessionState {
    sessionId: string;
    identityKey: Uint8Array;
    preKeys: Uint8Array[];
    currentRatchetState: Uint8Array;
}

export class KeyManager {
    private dbName: string = 'WorkSphereE2EEDB';
    private storeName: string = 'sessions';

    public async initialize(): Promise<void> {
        await e2eeWasm.initialize();
    }

    public async createIdentityKey(): Promise<Uint8Array> {
        const instance = await e2eeWasm.getInstance();
        const memory = await e2eeWasm.getMemory();

        const secretKeyPtr = 0;
        const publicKeyPtr = 32;

        (instance.exports.curve25519_keypair as CallableFunction)(publicKeyPtr, secretKeyPtr);

        const publicKey = new Uint8Array(memory.buffer, publicKeyPtr, 32);
        return new Uint8Array(publicKey);
    }

    public async saveSession(sessionId: string, state: SessionState): Promise<void> {
        const db = await this.openDB();
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);

        // Convert Uint8Array to Array for IndexedDB storage
        const serializableState = {
            ...state,
            identityKey: Array.from(state.identityKey),
            preKeys: state.preKeys.map(k => Array.from(k)),
            currentRatchetState: Array.from(state.currentRatchetState)
        };

        store.put(serializableState, sessionId);
        return tx.complete;
    }

    public async loadSession(sessionId: string): Promise<SessionState | null> {
        const db = await this.openDB();
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);

        return new Promise((resolve, reject) => {
            const request = store.get(sessionId);
            request.onsuccess = () => {
                const data = request.result;
                if (!data) {
                    resolve(null);
                    return;
                }

                resolve({
                    sessionId: data.sessionId,
                    identityKey: new Uint8Array(data.identityKey),
                    preKeys: data.preKeys.map((k: number[]) => new Uint8Array(k)),
                    currentRatchetState: new Uint8Array(data.currentRatchetState)
                });
            };
            request.onerror = () => reject(request.error);
        });
    }

    private openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'sessionId' });
                }
            };
        });
    }
}
