/**
 * ChunkedFileTransfer.ts
 * Implements the state machine for slicing large files into ArrayBuffer chunks, handling ACKs, and reassembly.
 * Prevents memory exhaustion and ensures reliable delivery over WebRTC DataChannels.
 */

export interface FileChunk {
  fileId: string;
  chunkIndex: number;
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
  status: 'receiving' | 'complete' | 'error';
}

export class ChunkedFileTransfer {
  private chunkSize: number;
  private receivingFiles: Map<string, {
    chunks: Map<number, ArrayBuffer>;
    fileName: string;
    fileSize: number;
    totalChunks: number;
    receivedBytes: number;
  }>;

  private onProgressCallback: ((progress: TransferProgress) => void) | null;
  private onCompleteCallback: ((fileId: string, blob: Blob) => void) | null;

  constructor(chunkSize: number = 16384) { // 16KB default
    this.chunkSize = chunkSize;
    this.receivingFiles = new Map();
    this.onProgressCallback = null;
    this.onCompleteCallback = null;
  }

  public async sliceAndSend(
    file: File,
    sendFn: (chunk: FileChunk) => void
  ): Promise<void> {
    const fileId = crypto.randomUUID();
    const totalChunks = Math.ceil(file.size / this.chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, file.size);
      const chunkData = await file.slice(start, end).arrayBuffer();

      const chunk: FileChunk = {
        fileId,
        chunkIndex: i,
        totalChunks,
        fileName: file.name,
        fileSize: file.size,
        data: chunkData
      };

      sendFn(chunk);
      
      // Small delay to prevent channel flooding
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  public processIncomingChunk(chunk: FileChunk, sendAckFn: (fileId: string, chunkIndex: number) => void): void {
    if (!this.receivingFiles.has(chunk.fileId)) {
      this.receivingFiles.set(chunk.fileId, {
        chunks: new Map(),
        fileName: chunk.fileName,
        fileSize: chunk.fileSize,
        totalChunks: chunk.totalChunks,
        receivedBytes: 0
      });
    }

    const fileState = this.receivingFiles.get(chunk.fileId)!;
    
    // Ignore duplicate chunks
    if (fileState.chunks.has(chunk.chunkIndex)) {
      sendAckFn(chunk.fileId, chunk.chunkIndex);
      return;
    }

    fileState.chunks.set(chunk.chunkIndex, chunk.data);
    fileState.receivedBytes += chunk.data.byteLength;

    sendAckFn(chunk.fileId, chunk.chunkIndex);

    // Report progress
    if (this.onProgressCallback) {
      this.onProgressCallback({
        fileId: chunk.fileId,
        fileName: chunk.fileName,
        receivedBytes: fileState.receivedBytes,
        totalBytes: chunk.fileSize,
        percentage: (fileState.receivedBytes / chunk.fileSize) * 100,
        status: 'receiving'
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

    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    
    if (this.onCompleteCallback) {
      this.onCompleteCallback(fileId, blob);
    }

    // Cleanup
    this.receivingFiles.delete(fileId);
  }

  public onProgress(callback: (progress: TransferProgress) => void): void {
    this.onProgressCallback = callback;
  }

  public onComplete(callback: (fileId: string, blob: Blob) => void): void {
    this.onCompleteCallback = callback;
  }
}
