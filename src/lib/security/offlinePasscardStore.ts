/**
 * Keeps signed offline passcard tokens in IndexedDB so the QR can be drawn with no network (#7271).
 *
 * One record per booking, keyed by `bookingId`. A token is bearer proof of entry, so an expired one is
 * never served: reading it removes it. Only the token string and the facts needed to index and expire it
 * are stored; no signing key ever reaches this store.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  decodeOfflinePasscardPayload,
  verifyOfflinePasscard,
} from "@/lib/security/offlineQrSigner";

export interface StoredOfflinePasscard {
  bookingId: string;
  venueId: string;
  token: string;
  /** Unix seconds, copied from the token so records can be expired without decoding. */
  validFrom: number;
  validUntil: number;
  /** Milliseconds since the epoch. */
  storedAt: number;
}

interface PasscardDB extends DBSchema {
  passcards: {
    key: string;
    value: StoredOfflinePasscard;
    indexes: { validUntil: number };
  };
}

const DB_NAME = "worksphere-offline-passcards";
const STORE = "passcards";

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

async function open(): Promise<IDBPDatabase<PasscardDB>> {
  return openDB<PasscardDB>(DB_NAME, 1, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, { keyPath: "bookingId" });
      store.createIndex("validUntil", "validUntil");
    },
  });
}

export interface SaveOfflinePasscardOptions {
  /** When given, the token's signature is checked first and a forged token is refused. */
  verificationKey?: CryptoKey;
}

/** Stores a token for its booking, replacing any earlier one. Throws if the token is malformed or forged. */
export async function saveOfflinePasscard(
  token: string,
  options: SaveOfflinePasscardOptions = {},
): Promise<StoredOfflinePasscard> {
  const payload = decodeOfflinePasscardPayload(token);
  if (!payload) throw new Error("Not a valid offline passcard token");
  if (options.verificationKey) {
    const result = await verifyOfflinePasscard(token, options.verificationKey, {
      enforceWindow: false,
    });
    if (!result.valid)
      throw new Error(
        `Offline passcard signature check failed: ${result.reason}`,
      );
  }
  if (!available()) throw new Error("IndexedDB is not available");

  const record: StoredOfflinePasscard = {
    bookingId: payload.bookingId,
    venueId: payload.venueId,
    token,
    validFrom: payload.validFrom,
    validUntil: payload.validUntil,
    storedAt: Date.now(),
  };
  const db = await open();
  try {
    await db.put(STORE, record);
  } finally {
    db.close();
  }
  return record;
}

/** The stored token for a booking, or null when there is none or it has expired (an expired one is deleted). */
export async function getOfflinePasscard(
  bookingId: string,
  now: number = Date.now(),
): Promise<string | null> {
  if (!available() || !bookingId) return null;
  const db = await open();
  try {
    const record = await db.get(STORE, bookingId);
    if (!record) return null;
    if (now > record.validUntil * 1000) {
      await db.delete(STORE, bookingId);
      return null;
    }
    return record.token;
  } finally {
    db.close();
  }
}

export async function deleteOfflinePasscard(bookingId: string): Promise<void> {
  if (!available()) return;
  const db = await open();
  try {
    await db.delete(STORE, bookingId);
  } finally {
    db.close();
  }
}

/** Removes every expired token and returns how many were removed. */
export async function pruneExpiredOfflinePasscards(
  now: number = Date.now(),
): Promise<number> {
  if (!available()) return 0;
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    // expired means now > validUntil * 1000, so validUntil < now / 1000
    const expired = await tx.store
      .index("validUntil")
      .getAll(IDBKeyRange.upperBound(now / 1000, true));
    for (const record of expired) await tx.store.delete(record.bookingId);
    await tx.done;
    return expired.length;
  } finally {
    db.close();
  }
}

/**
 * Stores the signed token(s) a booking confirmation came back with. The response field is
 * `offlinePasscard` on a booking object, or on each booking of a list. Best effort: a missing, malformed or
 * unstorable token is skipped, because a storage problem must never break a booking that already went
 * through. Returns how many tokens were stored.
 */
export async function storeOfflinePasscardsFromBooking(
  data: unknown,
): Promise<number> {
  const bookings = Array.isArray(data) ? data : [data];
  let stored = 0;
  for (const booking of bookings) {
    const token = (booking as { offlinePasscard?: unknown } | null)
      ?.offlinePasscard;
    if (typeof token !== "string") continue;
    try {
      await saveOfflinePasscard(token);
      stored += 1;
    } catch {
      // skipped on purpose: see above
    }
  }
  return stored;
}
