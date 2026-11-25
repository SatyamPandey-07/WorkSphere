/**
 * src/service-worker.ts
 *
 * ServiceWorker integration for WorkSphere PWA.
 * Listens for background sync events ('nomad-checkin-sync') and replays
 * offline desk check-ins stored in IndexedDB (#7427).
 */

import {
  SYNC_TAG,
  CHECKIN_STORE_NAME,
  CHECKIN_SYNC_BROADCAST_CHANNEL,
  replayCheckinQueue,
  openCheckinDB,
  ReplayOptions,
  ReplayResult,
} from "./lib/offline/syncQueue";
import {
  MIGRATION_BROADCAST_CHANNEL,
  openDatabaseWithMigration,
  closeDatabaseConnections,
  getMigrationDiagnostics,
} from "./lib/offline/migrationCoordinator";

export {
  SYNC_TAG,
  CHECKIN_STORE_NAME,
  CHECKIN_SYNC_BROADCAST_CHANNEL,
  MIGRATION_BROADCAST_CHANNEL,
  replayCheckinQueue,
  openCheckinDB,
  openDatabaseWithMigration,
  closeDatabaseConnections,
  getMigrationDiagnostics,
};
export type { ReplayOptions, ReplayResult };

export interface SyncEventLike {
  tag: string;
  waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * Handles incoming ServiceWorker background sync events.
 */
export async function handleSyncEvent(
  event: SyncEventLike,
  options?: ReplayOptions,
): Promise<boolean> {
  if (event.tag === SYNC_TAG) {
    const syncPromise = replayCheckinQueue(options);
    event.waitUntil(syncPromise);
    await syncPromise;
    return true;
  }
  return false;
}

// Attach event listener in ServiceWorker global scope if available
if (
  typeof self !== "undefined" &&
  "addEventListener" in self &&
  typeof (self as unknown as { addEventListener: (type: string, listener: (e: any) => void) => void }).addEventListener === "function"
) {
  (self as unknown as { addEventListener: (type: string, listener: (e: any) => void) => void }).addEventListener(
    "sync",
    (event: SyncEventLike) => {
      if (event.tag === SYNC_TAG) {
        event.waitUntil(replayCheckinQueue());
      }
    },
  );
}
