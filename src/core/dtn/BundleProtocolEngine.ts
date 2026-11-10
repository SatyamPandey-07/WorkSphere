import { openDB, IDBPDatabase } from "idb";

export interface DTNBundleHeader {
  bundleId: string;
  sourceEndpoint: string;
  destinationEndpoint: string;
  creationTimestamp: number;
  lifetimeTTL: number; // TTL in seconds
  custodyTransferRequested: boolean;
  signature?: string;
}

export interface DTNBundle<T = any> {
  header: DTNBundleHeader;
  payload: T;
  custodyAcceptedBy?: string[];
}

const DB_NAME = "worksphere-dtn-store";
const STORE_NAME = "dtn-bundles";

export class BundleProtocolEngine {
  private dbPromise: Promise<IDBPDatabase>;
  private nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "header.bundleId" });
          store.createIndex("by-ttl", "header.creationTimestamp");
        }
      },
    });
  }

  /**
   * Helper to compute cryptographic signature for bundle payload integrity
   */
  public async signPayload(payload: any, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload) + secret);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Creates, signs, and stores a new RFC 5050 bundle in IndexedDB
   */
  public async createBundle<T>(
    destinationEndpoint: string,
    payload: T,
    ttlSeconds: number = 86400, // 24 Hours default TTL
    secret: string = "worksphere-dtn-secret"
  ): Promise<DTNBundle<T>> {
    const bundleId = `bundle_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = Date.now();
    const signature = await this.signPayload(payload, secret);

    const bundle: DTNBundle<T> = {
      header: {
        bundleId,
        sourceEndpoint: this.nodeId,
        destinationEndpoint,
        creationTimestamp: timestamp,
        lifetimeTTL: ttlSeconds,
        custodyTransferRequested: true,
        signature,
      },
      payload,
      custodyAcceptedBy: [this.nodeId],
    };

    const db = await this.dbPromise;
    await db.put(STORE_NAME, bundle);
    return bundle;
  }

  /**
   * Retrieves all unexpired, valid bundles stored in IndexedDB
   */
  public async getUnexpiredBundles(): Promise<DTNBundle[]> {
    const db = await this.dbPromise;
    const allBundles: DTNBundle[] = await db.getAll(STORE_NAME);
    const now = Date.now();

    const validBundles: DTNBundle[] = [];
    const expiredIds: string[] = [];

    for (const bundle of allBundles) {
      const expirationTime = bundle.header.creationTimestamp + bundle.header.lifetimeTTL * 1000;
      if (now <= expirationTime) {
        validBundles.push(bundle);
      } else {
        expiredIds.push(bundle.header.bundleId);
      }
    }

    // Purge expired bundles automatically
    if (expiredIds.length > 0) {
      const tx = db.transaction(STORE_NAME, "readwrite");
      await Promise.all(expiredIds.map((id) => tx.store.delete(id)));
      await tx.done;
    }

    return validBundles;
  }

  /**
   * Handles peer exchange: receives bundles from another peer during WebRTC/Bluetooth contact
   */
  public async receiveBundlesFromPeer(incomingBundles: DTNBundle[]): Promise<string[]> {
    const db = await this.dbPromise;
    const acceptedIds: string[] = [];
    const now = Date.now();

    for (const bundle of incomingBundles) {
      const expirationTime = bundle.header.creationTimestamp + bundle.header.lifetimeTTL * 1000;
      if (now > expirationTime) continue; // Skip expired bundles

      const existing = await db.get(STORE_NAME, bundle.header.bundleId);
      if (!existing) {
        const updatedBundle: DTNBundle = {
          ...bundle,
          custodyAcceptedBy: [...(bundle.custodyAcceptedBy || []), this.nodeId],
        };
        await db.put(STORE_NAME, updatedBundle);
        acceptedIds.push(bundle.header.bundleId);
      }
    }

    return acceptedIds;
  }

  /**
   * Purges all expired bundles from IndexedDB manually
   */
  public async purgeExpiredBundles(): Promise<number> {
    const db = await this.dbPromise;
    const allBundles: DTNBundle[] = await db.getAll(STORE_NAME);
    const now = Date.now();
    let purgedCount = 0;

    const tx = db.transaction(STORE_NAME, "readwrite");
    for (const bundle of allBundles) {
      const expirationTime = bundle.header.creationTimestamp + bundle.header.lifetimeTTL * 1000;
      if (now > expirationTime) {
        await tx.store.delete(bundle.header.bundleId);
        purgedCount++;
      }
    }
    await tx.done;
    return purgedCount;
  }
}