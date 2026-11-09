import "fake-indexeddb/auto";
import { render, screen, cleanup } from "@testing-library/react";
import {
  WebLocksDiagnosticPanel,
  wrapIdbTransaction,
  executeSynchronizedWrite,
} from "@/components/WebLocksDiagnosticPanel";

// Mock offlineStore functions
jest.mock("@/lib/offlineStore", () => ({
  getQueuedFavorites: jest.fn().mockResolvedValue([]),
  getQueuedCheckIns: jest.fn().mockResolvedValue([]),
  OFFLINE_WRITE_LOCK: "worksphere-offline-write-lock",
}));

// Mock webLock OFFLINE_WRITE_LOCK constant
jest.mock("@/lib/webLock", () => ({
  OFFLINE_WRITE_LOCK: "worksphere-offline-write-lock",
}));

describe("WebLocksDiagnosticPanel", () => {
  const mockLocks = {
    query: jest.fn().mockResolvedValue({ held: [], pending: [] }),
    request: jest
      .fn()
      .mockImplementation((_name, _optionsOrCallback, maybeCallback) => {
        const callback =
          typeof _optionsOrCallback === "function"
            ? _optionsOrCallback
            : maybeCallback;
        return callback ? callback() : Promise.resolve();
      }),
  };

  beforeEach(() => {
    Object.defineProperty(navigator, "locks", {
      value: mockLocks,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the 'Web Locks Diagnostic' heading", async () => {
    render(<WebLocksDiagnosticPanel />);
    expect(await screen.findByText("Web Locks Diagnostic")).toBeInTheDocument();
  });

  it("shows warning when Web Locks API is unsupported", async () => {
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<WebLocksDiagnosticPanel />);
    expect(
      await screen.findByText(/Web Locks API not supported in this browser/i),
    ).toBeInTheDocument();
  });

  it("renders a refresh button", async () => {
    render(<WebLocksDiagnosticPanel />);
    const refreshBtn = await screen.findByRole("button", { name: /refresh/i });
    expect(refreshBtn).toBeInTheDocument();
  });

  it("renders the Sync Outbox section label", async () => {
    render(<WebLocksDiagnosticPanel />);
    expect(await screen.findByText(/sync outbox/i)).toBeInTheDocument();
  });

  it("renders the Test Synchronized IDB Write button", async () => {
    render(<WebLocksDiagnosticPanel />);
    expect(
      await screen.findByRole("button", {
        name: /test synchronized idb write/i,
      }),
    ).toBeInTheDocument();
  });

  describe("IDBTransaction & Web Lock Synchronization", () => {
    let db: IDBDatabase;

    beforeEach(async () => {
      const dbName = `test-sync-db-${Date.now()}-${Math.random()}`;
      const openReq = indexedDB.open(dbName, 1);
      openReq.onupgradeneeded = (e) => {
        const targetDb = (e.target as IDBOpenDBRequest).result;
        targetDb.createObjectStore("records", { keyPath: "id" });
      };
      db = await new Promise<IDBDatabase>((res, rej) => {
        openReq.onsuccess = () => res(openReq.result);
        openReq.onerror = () => rej(openReq.error);
      });
    });

    afterEach(() => {
      db.close();
    });

    it("wraps IDB write transactions in a Promise resolving strictly on transaction.oncomplete", async () => {
      const tx = db.transaction("records", "readwrite");
      const store = tx.objectStore("records");
      let completed = false;

      const promise = wrapIdbTransaction(tx).then(() => {
        completed = true;
      });

      store.put({ id: "rec-1", value: "hello" });
      expect(completed).toBe(false);

      await promise;
      expect(completed).toBe(true);
    });

    it("rejects wrapIdbTransaction Promise when transaction is aborted", async () => {
      const abortTx = db.transaction("records", "readwrite");
      const abortPromise = wrapIdbTransaction(abortTx);
      abortTx.abort();

      await expect(abortPromise).rejects.toThrow();
    });

    it("ensures lock callback awaits the transaction promise before releasing Web Lock", async () => {
      let lockHeld = false;
      let releasedBeforeComplete = false;

      const mockRequest = jest
        .fn()
        .mockImplementation(async (_name, callback) => {
          lockHeld = true;
          try {
            return await callback();
          } finally {
            lockHeld = false;
          }
        });

      Object.defineProperty(navigator, "locks", {
        value: { request: mockRequest },
        configurable: true,
        writable: true,
      });

      let completeFired = false;
      await executeSynchronizedWrite(db, "records", (tx) => {
        const store = tx.objectStore("records");
        store.put({ id: "rec-lock", value: "guarded" });

        const originalOnComplete = tx.oncomplete;
        tx.oncomplete = (e) => {
          completeFired = true;
          // While oncomplete is firing or before callback resolves, lock must still be held
          if (!lockHeld) {
            releasedBeforeComplete = true;
          }
          if (typeof originalOnComplete === "function") {
            originalOnComplete.call(tx, e);
          }
        };
      });

      expect(completeFired).toBe(true);
      expect(releasedBeforeComplete).toBe(false);
      expect(lockHeld).toBe(false);
    });

    it("multi-tab concurrency test verifying zero dirty reads during simultaneous writes", async () => {
      // Simulate Web Locks FIFO queue across multiple tabs
      let lockQueue = Promise.resolve();
      const concurrencyLog: string[] = [];
      let dirtyReads = 0;

      const mockRequest = jest.fn().mockImplementation((_name, callback) => {
        const currentLock = lockQueue.then(async () => {
          concurrencyLog.push("lock:acquired");
          try {
            return await callback();
          } finally {
            concurrencyLog.push("lock:released");
          }
        });
        lockQueue = currentLock.catch(() => {});
        return currentLock;
      });

      Object.defineProperty(navigator, "locks", {
        value: { request: mockRequest },
        configurable: true,
        writable: true,
      });

      // Populate initial state
      const initTx = db.transaction("records", "readwrite");
      initTx
        .objectStore("records")
        .put({ id: "state-doc", version: 0, status: "INITIAL" });
      await wrapIdbTransaction(initTx);

      // Tab 1 performs a write of version 1
      const tab1Write = executeSynchronizedWrite(db, "records", (tx) => {
        concurrencyLog.push("tab1:writing");
        const store = tx.objectStore("records");
        store.put({ id: "state-doc", version: 1, status: "COMMITTED_V1" });
      });

      // Tab 2 simultaneously attempts to read and write under Web Lock
      const tab2ReadWrite = executeSynchronizedWrite(
        db,
        "records",
        async (tx) => {
          concurrencyLog.push("tab2:reading");
          const store = tx.objectStore("records");
          const getReq = store.get("state-doc");
          const readResult = await new Promise<any>((res, rej) => {
            getReq.onsuccess = () => res(getReq.result);
            getReq.onerror = () => rej(getReq.error);
          });

          // Tab 2 must strictly observe the fully committed state from Tab 1
          if (
            !readResult ||
            readResult.version !== 1 ||
            readResult.status !== "COMMITTED_V1"
          ) {
            dirtyReads++;
          }

          // Tab 2 commits its subsequent update
          store.put({ id: "state-doc", version: 2, status: "COMMITTED_V2" });
        },
      );

      await Promise.all([tab1Write, tab2ReadWrite]);

      // Verify zero dirty reads during simultaneous writes
      expect(dirtyReads).toBe(0);

      // Verify Tab 2 only read after Tab 1 released the lock
      const tab1WriteIdx = concurrencyLog.indexOf("tab1:writing");
      const tab2ReadIdx = concurrencyLog.indexOf("tab2:reading");
      expect(tab1WriteIdx).toBeGreaterThanOrEqual(0);
      expect(tab2ReadIdx).toBeGreaterThan(tab1WriteIdx);

      // Verify final committed state in IDB
      const verifyTx = db.transaction("records", "readonly");
      const finalRecord = await new Promise<any>((res) => {
        const req = verifyTx.objectStore("records").get("state-doc");
        req.onsuccess = () => res(req.result);
      });
      expect(finalRecord.version).toBe(2);
      expect(finalRecord.status).toBe("COMMITTED_V2");
    });
  });
});
