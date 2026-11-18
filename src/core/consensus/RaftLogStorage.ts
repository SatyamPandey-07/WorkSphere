import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface ReserveDeskCommand {
  type: "RESERVE_DESK";
  reservationId: string;
  deskId: string;
  venueId: string;
  memberId: string;
  expiresAt: number;
}

export interface ReleaseDeskCommand {
  type: "RELEASE_DESK";
  reservationId: string;
}

export interface NoopCommand {
  type: "NOOP";
}

export type RaftCommand =
  | ReserveDeskCommand
  | ReleaseDeskCommand
  | NoopCommand;

export interface RaftLogEntry {
  index: number;
  term: number;
  command: RaftCommand;
  timestamp: number;
}

export interface RaftMeta {
  currentTerm: number;
  votedFor: string | null;
}

export interface RaftPersistentState extends RaftMeta {
  log: RaftLogEntry[];
}

export interface RaftLogStorageBackend {
  load(): Promise<RaftPersistentState>;
  saveMeta(meta: RaftMeta): Promise<void>;
  appendEntry(entry: RaftLogEntry): Promise<void>;
  truncateFrom(index: number): Promise<void>;
  replaceLog(entries: RaftLogEntry[]): Promise<void>;
  close(): Promise<void>;
}

export type RaftLogStorageBackendKind = "auto" | "indexeddb" | "memory";

export interface RaftLogStorageOptions {
  backend?: RaftLogStorageBackendKind;
  dbName?: string;
  namespace?: string;
}

const DEFAULT_DB_NAME = "worksphere-raft";

function cloneEntry(entry: RaftLogEntry): RaftLogEntry {
  return JSON.parse(JSON.stringify(entry)) as RaftLogEntry;
}

export class MemoryRaftLogStorage implements RaftLogStorageBackend {
  private currentTerm = 0;
  private votedFor: string | null = null;
  private log: RaftLogEntry[] = [];

  public async load(): Promise<RaftPersistentState> {
    return {
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      log: this.log.map(cloneEntry),
    };
  }

  public async saveMeta(meta: RaftMeta): Promise<void> {
    this.currentTerm = meta.currentTerm;
    this.votedFor = meta.votedFor;
  }

  public async appendEntry(entry: RaftLogEntry): Promise<void> {
    const cloned = cloneEntry(entry);
    const existingIndex = this.log.findIndex((item) => item.index === entry.index);
    if (existingIndex >= 0) {
      this.log[existingIndex] = cloned;
    } else {
      this.log.push(cloned);
      this.log.sort((a, b) => a.index - b.index);
    }
  }

  public async truncateFrom(index: number): Promise<void> {
    this.log = this.log.filter((entry) => entry.index < index);
  }

  public async replaceLog(entries: RaftLogEntry[]): Promise<void> {
    this.log = entries.map(cloneEntry).sort((a, b) => a.index - b.index);
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}

interface RaftDbSchema extends DBSchema {
  meta: {
    key: string;
    value: { key: string; value: number | string | null };
  };
  log: {
    key: number;
    value: RaftLogEntry;
  };
}

export class IndexedDbRaftLogStorage implements RaftLogStorageBackend {
  constructor(private readonly db: IDBPDatabase<RaftDbSchema>) {}

  public async load(): Promise<RaftPersistentState> {
    const [termRecord, voteRecord, log] = await Promise.all([
      this.db.get("meta", "currentTerm"),
      this.db.get("meta", "votedFor"),
      this.db.getAll("log"),
    ]);

    return {
      currentTerm:
        typeof termRecord?.value === "number" ? termRecord.value : 0,
      votedFor:
        typeof voteRecord?.value === "string" ? voteRecord.value : null,
      log: log.sort((a, b) => a.index - b.index),
    };
  }

  public async saveMeta(meta: RaftMeta): Promise<void> {
    const tx = this.db.transaction("meta", "readwrite");
    await tx.store.put({ key: "currentTerm", value: meta.currentTerm });
    await tx.store.put({ key: "votedFor", value: meta.votedFor });
    await tx.done;
  }

  public async appendEntry(entry: RaftLogEntry): Promise<void> {
    await this.db.put("log", entry);
  }

  public async truncateFrom(index: number): Promise<void> {
    const tx = this.db.transaction("log", "readwrite");
    for await (const cursor of tx.store.iterate()) {
      if (cursor.value.index >= index) {
        await cursor.delete();
      }
    }
    await tx.done;
  }

  public async replaceLog(entries: RaftLogEntry[]): Promise<void> {
    const tx = this.db.transaction("log", "readwrite");
    await tx.store.clear();
    for (const entry of entries) {
      await tx.store.put(entry);
    }
    await tx.done;
  }

  public async close(): Promise<void> {
    this.db.close();
  }
}

export class RaftLogStorage implements RaftLogStorageBackend {
  private constructor(
    private readonly backend: RaftLogStorageBackend,
    public readonly kind: "indexeddb" | "memory",
  ) {}

  public static async open(
    options: RaftLogStorageOptions = {},
  ): Promise<RaftLogStorage> {
    const requested = options.backend ?? "auto";
    const hasIndexedDb = typeof indexedDB !== "undefined";

    if (requested === "memory" || (requested === "auto" && !hasIndexedDb)) {
      return new RaftLogStorage(new MemoryRaftLogStorage(), "memory");
    }

    if (requested === "indexeddb" && !hasIndexedDb) {
      throw new Error(
        "IndexedDB is unavailable; use the memory backend for this runtime",
      );
    }

    const baseName = options.dbName ?? DEFAULT_DB_NAME;
    const dbName = options.namespace
      ? `${baseName}-${options.namespace}`
      : baseName;

    try {
      const db = await openDB<RaftDbSchema>(dbName, 1, {
        upgrade(database) {
          if (!database.objectStoreNames.contains("meta")) {
            database.createObjectStore("meta", { keyPath: "key" });
          }
          if (!database.objectStoreNames.contains("log")) {
            database.createObjectStore("log", { keyPath: "index" });
          }
        },
      });

      return new RaftLogStorage(new IndexedDbRaftLogStorage(db), "indexeddb");
    } catch (error) {
      if (requested === "indexeddb") {
        throw error;
      }
      return new RaftLogStorage(new MemoryRaftLogStorage(), "memory");
    }
  }

  public load(): Promise<RaftPersistentState> {
    return this.backend.load();
  }

  public saveMeta(meta: RaftMeta): Promise<void> {
    return this.backend.saveMeta(meta);
  }

  public appendEntry(entry: RaftLogEntry): Promise<void> {
    return this.backend.appendEntry(entry);
  }

  public truncateFrom(index: number): Promise<void> {
    return this.backend.truncateFrom(index);
  }

  public replaceLog(entries: RaftLogEntry[]): Promise<void> {
    return this.backend.replaceLog(entries);
  }

  public close(): Promise<void> {
    return this.backend.close();
  }
}
