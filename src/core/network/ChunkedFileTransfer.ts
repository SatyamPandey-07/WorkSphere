/**
 * ChunkedFileTransfer.ts
 * Implements the state machine for slicing large files into ArrayBuffer chunks, handling ACKs, and reassembly.
 * Supports pause, cancel, and resume of transfers with chunk progress stored in IndexedDB sessions (#5635).
 * Prevents memory exhaustion and ensures reliable delivery over WebRTC DataChannels.
 */

export interface FileChunk {
  fileId: string;
  chunkIndex: number;
  sequenceNumber?: number;
  totalChunks: number;
  fileName: string;
  fileSize: number;
  data: ArrayBuffer;
}

export interface TransferProgress {
  fileId: string;
  fileName: string;
  receivedBytes: number;
  totalBytes: number;
  percentage: number;
  status:
    | "transmitting"
    | "receiving"
    | "paused"
    | "cancelled"
    | "resuming"
    | "complete"
    | "error";
}

export interface TransferSession {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  receivedChunks: number[];
  transferredBytes: number;
  status: "transmitting" | "receiving" | "paused" | "cancelled" | "complete";
  updatedAt: number;
}

export interface TransferInquiry {
  type: "INQUIRY";
  fileId: string;
}

export interface TransferInquiryResponse {
  type: "INQUIRY_RESPONSE";
  fileId: string;
  receivedChunkIndices: number[];
}

export class ChunkedFileTransfer {
  private chunkSize: number;
  private receivingFiles: Map<
    string,
    {
      chunks: Map<number, ArrayBuffer>;
      fileName: string;
      fileSize: number;
      totalChunks: number;
      receivedBytes: number;
      receivedSequenceNumbers: Set<number>;
    }
  >;

  private onProgressCallback: ((progress: TransferProgress) => void) | null;
  private onCompleteCallback: ((fileId: string, blob: Blob) => void) | null;

  // Active sender tracking for pause, cancel, and resume
  private activeSenders: Map<
    string,
    {
      file: File;
      sendFn: (chunk: FileChunk) => void;
      isPaused: boolean;
      isCancelled: boolean;
      currentChunk: number;
    }
  >;
  private pausedTransfers: Set<string>;
  private cancelledTransfers: Set<string>;

  // In-memory session store fallback when IndexedDB is unavailable
  private inMemorySessions: Map<string, TransferSession>;

  private static readonly DB_NAME = "WorkSphereChunkedTransferDB";
  private static readonly STORE_NAME = "transfer_sessions";
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(chunkSize: number = 16384) {
    // 16KB default
    this.chunkSize = chunkSize;
    this.receivingFiles = new Map();
    this.activeSenders = new Map();
    this.pausedTransfers = new Set();
    this.cancelledTransfers = new Set();
    this.inMemorySessions = new Map();
    this.onProgressCallback = null;
    this.onCompleteCallback = null;
  }

  /**
   * Opens or returns the IndexedDB instance for persisting transfer sessions.
   * Returns null if IndexedDB is not supported in the execution environment.
   */
  private async getDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") {
      return null;
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(ChunkedFileTransfer.DB_NAME, 1);
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(ChunkedFileTransfer.STORE_NAME)) {
            db.createObjectStore(ChunkedFileTransfer.STORE_NAME, {
              keyPath: "fileId",
            });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  /**
   * Retrieves stored session state from IndexedDB or in-memory fallback.
   */
  public async getSession(fileId: string): Promise<TransferSession | null> {
    const db = await this.getDB();
    if (!db) {
      return this.inMemorySessions.get(fileId) || null;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(ChunkedFileTransfer.STORE_NAME, "readonly");
        const store = tx.objectStore(ChunkedFileTransfer.STORE_NAME);
        const req = store.get(fileId);
        req.onsuccess = () =>
          resolve(
            (req.result as TransferSession) ||
              this.inMemorySessions.get(fileId) ||
              null,
          );
        req.onerror = () => resolve(this.inMemorySessions.get(fileId) || null);
      } catch {
        resolve(this.inMemorySessions.get(fileId) || null);
      }
    });
  }

  /**
   * Saves or updates session progress in IndexedDB and in-memory cache.
   */
  public async saveSession(session: TransferSession): Promise<void> {
    this.inMemorySessions.set(session.fileId, session);
    const db = await this.getDB();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(ChunkedFileTransfer.STORE_NAME, "readwrite");
        const store = tx.objectStore(ChunkedFileTransfer.STORE_NAME);
        store.put(session);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Removes session state upon transfer completion or cancellation.
   */
  public async deleteSession(fileId: string): Promise<void> {
    this.inMemorySessions.delete(fileId);
    const db = await this.getDB();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(ChunkedFileTransfer.STORE_NAME, "readwrite");
        const store = tx.objectStore(ChunkedFileTransfer.STORE_NAME);
        store.delete(fileId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Pauses an ongoing transfer by fileId, or pauses all active transfers if no id is specified.
   */
  public pauseTransfer(fileId?: string): void {
    if (fileId) {
      this.pausedTransfers.add(fileId);
      const sender = this.activeSenders.get(fileId);
      if (sender) {
        sender.isPaused = true;
      }
      const existing = this.inMemorySessions.get(fileId);
      if (existing) {
        existing.status = "paused";
        void this.saveSession(existing);
      }
    } else {
      for (const [id, sender] of this.activeSenders.entries()) {
        this.pausedTransfers.add(id);
        sender.isPaused = true;
        const existing = this.inMemorySessions.get(id);
        if (existing) {
          existing.status = "paused";
          void this.saveSession(existing);
        }
      }
    }
  }

  /**
   * Cancels an ongoing transfer and cleans up associated state and storage.
   */
  public cancelTransfer(fileId: string): void {
    this.cancelledTransfers.add(fileId);
    const sender = this.activeSenders.get(fileId);
    if (sender) {
      sender.isCancelled = true;
    }
    this.receivingFiles.delete(fileId);
    this.activeSenders.delete(fileId);
    void this.deleteSession(fileId);

    if (this.onProgressCallback && sender) {
      this.onProgressCallback({
        fileId,
        fileName: sender.file.name,
        receivedBytes: 0,
        totalBytes: sender.file.size,
        percentage: 0,
        status: "cancelled",
      });
    }
  }

  /**
   * Resumes an interrupted or paused file transfer.
   * Transmits only missing chunks by querying stored session state.
   */
  public async resumeTransfer(
    fileId: string,
    file?: File,
    sendFn?: (chunk: FileChunk) => void,
  ): Promise<void> {
    const sender = this.activeSenders.get(fileId);
    const targetFile = file || sender?.file;
    const targetSendFn = sendFn || sender?.sendFn;

    if (!targetFile || !targetSendFn) {
      throw new Error(
        `Cannot resume transfer ${fileId}: missing file or send function.`,
      );
    }

    this.pausedTransfers.delete(fileId);
    this.cancelledTransfers.delete(fileId);

    if (this.onProgressCallback) {
      const session = await this.getSession(fileId);
      const transferredBytes = session
        ? session.receivedChunks.length * this.chunkSize
        : 0;
      this.onProgressCallback({
        fileId,
        fileName: targetFile.name,
        receivedBytes: transferredBytes,
        totalBytes: targetFile.size,
        percentage: (transferredBytes / targetFile.size) * 100,
        status: "resuming",
      });
    }

    await this.sliceAndSend(targetFile, targetSendFn, fileId);
  }

  /**
   * Creates an inquiry packet to request the list of received chunk indices from peer.
   */
  public createInquiry(fileId: string): TransferInquiry {
    return { type: "INQUIRY", fileId };
  }

  /**
   * Handles an incoming inquiry from sender, responding with received chunk indices.
   */
  public handleInquiry(fileId: string): TransferInquiryResponse {
    const fileState = this.receivingFiles.get(fileId);
    const received = fileState ? Array.from(fileState.chunks.keys()) : [];
    return {
      type: "INQUIRY_RESPONSE",
      fileId,
      receivedChunkIndices: received,
    };
  }

  /**
   * Slices a file into chunks and streams them via sendFn.
   * If existingFileId is supplied, resumes transmission by skipping already acknowledged chunks.
   */
  public async sliceAndSend(
    file: File,
    sendFn: (chunk: FileChunk) => void,
    existingFileId?: string,
  ): Promise<void> {
    const fileId = existingFileId || crypto.randomUUID();
    const totalChunks = Math.ceil(file.size / this.chunkSize);

    this.pausedTransfers.delete(fileId);
    this.cancelledTransfers.delete(fileId);

    const senderState = {
      file,
      sendFn,
      isPaused: false,
      isCancelled: false,
      currentChunk: 0,
    };
    this.activeSenders.set(fileId, senderState);

    // Retrieve previously acknowledged chunks from session
    const existingSession = await this.getSession(fileId);
    const receivedChunksSet = new Set<number>(
      existingSession ? existingSession.receivedChunks : [],
    );

    for (let i = 0; i < totalChunks; i++) {
      if (senderState.isCancelled || this.cancelledTransfers.has(fileId)) {
        this.activeSenders.delete(fileId);
        return;
      }

      if (senderState.isPaused || this.pausedTransfers.has(fileId)) {
        await this.saveSession({
          fileId,
          fileName: file.name,
          fileSize: file.size,
          totalChunks,
          chunkSize: this.chunkSize,
          receivedChunks: Array.from(receivedChunksSet),
          transferredBytes: receivedChunksSet.size * this.chunkSize,
          status: "paused",
          updatedAt: Date.now(),
        });

        if (this.onProgressCallback) {
          const sentBytes = Math.min(
            receivedChunksSet.size * this.chunkSize,
            file.size,
          );
          this.onProgressCallback({
            fileId,
            fileName: file.name,
            receivedBytes: sentBytes,
            totalBytes: file.size,
            percentage: (sentBytes / file.size) * 100,
            status: "paused",
          });
        }
        return;
      }

      // Skip chunks that the receiver has already verified
      if (receivedChunksSet.has(i)) {
        continue;
      }

      senderState.currentChunk = i;
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, file.size);
      const chunkData = await file.slice(start, end).arrayBuffer();

      const chunk: FileChunk = {
        fileId,
        chunkIndex: i,
        sequenceNumber: i,
        totalChunks,
        fileName: file.name,
        fileSize: file.size,
        data: chunkData,
      };

      sendFn(chunk);
      receivedChunksSet.add(i);

      // Persist session progress
      await this.saveSession({
        fileId,
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        chunkSize: this.chunkSize,
        receivedChunks: Array.from(receivedChunksSet),
        transferredBytes: Math.min(
          receivedChunksSet.size * this.chunkSize,
          file.size,
        ),
        status: "transmitting",
        updatedAt: Date.now(),
      });

      // Small delay to prevent channel flooding
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    this.activeSenders.delete(fileId);
    await this.saveSession({
      fileId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      chunkSize: this.chunkSize,
      receivedChunks: Array.from(receivedChunksSet),
      transferredBytes: file.size,
      status: "complete",
      updatedAt: Date.now(),
    });
  }

  public processIncomingChunk(
    chunk: FileChunk,
    sendAckFn: (fileId: string, chunkIndex: number) => void,
  ): void {
    // Validate chunk parameters
    if (chunk.chunkIndex < 0 || chunk.chunkIndex >= chunk.totalChunks) {
      console.warn(
        `[ChunkedFileTransfer] Discarding out-of-bounds chunk index ${chunk.chunkIndex} for total ${chunk.totalChunks}`,
      );
      return;
    }

    if (!this.receivingFiles.has(chunk.fileId)) {
      this.receivingFiles.set(chunk.fileId, {
        chunks: new Map(),
        fileName: chunk.fileName,
        fileSize: chunk.fileSize,
        totalChunks: chunk.totalChunks,
        receivedBytes: 0,
        receivedSequenceNumbers: new Set(),
      });
    }

    const fileState = this.receivingFiles.get(chunk.fileId)!;

    // Resolve duplicate chunk sequence numbers / indices
    const seqNum = chunk.sequenceNumber ?? chunk.chunkIndex;
    const isDuplicate =
      fileState.chunks.has(chunk.chunkIndex) ||
      fileState.receivedSequenceNumbers.has(seqNum);

    if (isDuplicate) {
      // Re-acknowledge duplicate chunk to resolve sender ACK timeout without double counting bytes
      sendAckFn(chunk.fileId, chunk.chunkIndex);
      return;
    }

    fileState.chunks.set(chunk.chunkIndex, chunk.data);
    fileState.receivedSequenceNumbers.add(seqNum);
    fileState.receivedBytes += chunk.data.byteLength;

    sendAckFn(chunk.fileId, chunk.chunkIndex);

    // Save receiver-side session progress
    void this.saveSession({
      fileId: chunk.fileId,
      fileName: chunk.fileName,
      fileSize: chunk.fileSize,
      totalChunks: chunk.totalChunks,
      chunkSize: this.chunkSize,
      receivedChunks: Array.from(fileState.chunks.keys()),
      transferredBytes: fileState.receivedBytes,
      status:
        fileState.chunks.size === fileState.totalChunks
          ? "complete"
          : "receiving",
      updatedAt: Date.now(),
    });

    // Report progress
    if (this.onProgressCallback) {
      this.onProgressCallback({
        fileId: chunk.fileId,
        fileName: chunk.fileName,
        receivedBytes: fileState.receivedBytes,
        totalBytes: chunk.fileSize,
        percentage: Math.min(
          100,
          (fileState.receivedBytes / chunk.fileSize) * 100,
        ),
        status: "receiving",
      });
    }

    // Check if complete
    if (fileState.chunks.size === fileState.totalChunks) {
      this.assembleFile(chunk.fileId);
    }
  }

  private assembleFile(fileId: string): void {
    const fileState = this.receivingFiles.get(fileId);
    if (!fileState) return;

    const chunks: ArrayBuffer[] = [];
    for (let i = 0; i < fileState.totalChunks; i++) {
      const chunk = fileState.chunks.get(i);
      if (chunk) {
        chunks.push(chunk);
      }
    }

    const blob = new Blob(chunks, { type: "application/octet-stream" });

    if (this.onCompleteCallback) {
      this.onCompleteCallback(fileId, blob);
    }

    // Cleanup
    this.receivingFiles.delete(fileId);
    void this.deleteSession(fileId);
  }

  public isChunkReceived(fileId: string, chunkIndex: number): boolean {
    const fileState = this.receivingFiles.get(fileId);
    return fileState ? fileState.chunks.has(chunkIndex) : false;
  }

  public getMissingChunks(fileId: string): number[] {
    const fileState = this.receivingFiles.get(fileId);
    if (!fileState) return [];

    const missing: number[] = [];
    for (let i = 0; i < fileState.totalChunks; i++) {
      if (!fileState.chunks.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  public onProgress(callback: (progress: TransferProgress) => void): void {
    this.onProgressCallback = callback;
  }

  public onComplete(callback: (fileId: string, blob: Blob) => void): void {
    this.onCompleteCallback = callback;
  }
}
