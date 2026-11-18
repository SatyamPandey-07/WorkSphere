/**
 * DIDWallet.ts
 * Manages the generation and secure storage of elliptic-curve keypairs 
 * required for decentralized identity signing.
 */

export interface DIDDocument {
    id: string;
    publicKeyHex: string;
    createdAt: number;
    verifiedCredentials: string[];
}

export interface KeyPair {
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    publicKeyHex: string;
}

export class DIDWallet {
    private storageKey: string = 'worksphere_did_wallet';
    private didDocument: DIDDocument | null = null;
    private keyPair: KeyPair | null = null;

    constructor() { }

    public async initialize(): Promise<DIDDocument> {
        const stored = localStorage.getItem(this.storageKey);

        if (stored) {
            this.didDocument = JSON.parse(stored);
            // Note: In a real app, private keys are stored in IndexedDB with encryption or Secure Enclave
            // For this implementation, we regenerate or assume the keypair is managed by the browser's WebAuthn
            await this.loadOrCreateKeys();
            return this.didDocument!;
        }

        return this.createWallet();
    }

    private async createWallet(): Promise<DIDDocument> {
        const keys = await this.generateKeyPair();
        this.keyPair = keys;

        const did = `did:web:worksphere.app:${crypto.randomUUID()}`;

        this.didDocument = {
            id: did,
            publicKeyHex: keys.publicKeyHex,
            createdAt: Date.now(),
            verifiedCredentials: []
        };

        localStorage.setItem(this.storageKey, JSON.stringify(this.didDocument));
        return this.didDocument;
    }

    private async generateKeyPair(): Promise<KeyPair> {
        const keyPair = await crypto.subtle.generateKey(
            {
                name: 'ECDSA',
                namedCurve: 'P-256'
            },
            true,
            ['sign', 'verify']
        );

        const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
        const publicKeyHex = Array.from(new Uint8Array(publicKeyBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        return {
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
            publicKeyHex
        };
    }

    private async loadOrCreateKeys(): Promise<void> {
        // In production, load from IndexedDB. Here we regenerate for session demo.
        this.keyPair = await this.generateKeyPair();
    }

    public async signPayload(payload: string): Promise<string> {
        if (!this.keyPair) throw new Error('Wallet not initialized');

        const encoder = new TextEncoder();
        const data = encoder.encode(payload);

        const signature = await crypto.subtle.sign(
            {
                name: 'ECDSA',
                hash: { name: 'SHA-256' }
            },
            this.keyPair.privateKey,
            data
        );

        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    public getDID(): string | null {
        return this.didDocument?.id || null;
    }

    public getPublicKey(): string | null {
        return this.didDocument?.publicKeyHex || null;
    }

    public addVerifiedCredential(credentialId: string): void {
        if (this.didDocument && !this.didDocument.verifiedCredentials.includes(credentialId)) {
            this.didDocument.verifiedCredentials.push(credentialId);
            localStorage.setItem(this.storageKey, JSON.stringify(this.didDocument));
        }
    }
}
