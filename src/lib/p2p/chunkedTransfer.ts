/**
 * P2P Chunked Binary File Transfer Engine (#5812)
 *
 * Slices files into 64KB binary chunks before transmitting over WebRTC data channels.
 * Uses backpressure monitoring (bufferedAmountLowThreshold) to prevent SCTP buffer overflow
 * and browser memory exhaustion for files larger than 16MB.
 * Computes and verifies SHA-256 checksums before completing transfers.
 */

export const P2P_CHUNK_SIZE = 64 * 1024; // 64KB (65,536 bytes)
export const DEFAULT_BUFFERED_AMOUNT_LOW_THRESHOLD = 64 * 1024; // 64KB
const BINARY_PACKET_MAGIC = 0x50; // 'P'

export interface ChunkedTransferProgress {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  progress: number; // 0 to 100
  bytesTransferred: number;
  totalChunks: number;
  currentChunk: number;
  speedBps: number; // Bytes per second
  speedMBps: number; // Megabytes per second
  etaSeconds: number; // Estimated seconds remaining
  status:
    | "encrypting"
    | "sending"
    | "receiving"
    | "verifying"
    | "complete"
    | "failed"
    | "paused";
  checksum?: string;
  actualChecksum?: string;
  direction: "send" | "receive";
  peerId: string;
  blobUrl?: string;
  error?: string;
  isPaused?: boolean;
}

export interface FileMetadataMessage {
  type: "chunked-file-metadata";
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  checksum: string;
}

export interface FileCompleteMessage {
  type: "chunked-file-complete";
  transferId: string;
  checksum: string;
}

export interface FileControlMessage {
  type: "chunked-file-control";
  transferId: string;
  action: "pause" | "resume" | "cancel";
}

/**
 * Waits for WebRTC data channel backpressure to drain below the threshold.
 * Uses bufferedamountlow event listener to prevent SCTP queue overflow.
 */
export async function waitForBufferedAmountLow(
  channel: RTCDataChannel,
  threshold: number = DEFAULT_BUFFERED_AMOUNT_LOW_THRESHOLD,
): Promise<void> {
  try {
    channel.bufferedAmountLowThreshold = threshold;
  } catch {
    // In mock environments or older implementations, setting this might throw
  }

  if (channel.bufferedAmount <= threshold) {
    return;
  }

  await new Promise<void>((resolve) => {
    let resolved = false;

    const onLow = () => {
      if (resolved) return;
      resolved = true;
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };

    channel.addEventListener("bufferedamountlow", onLow);

    // Safety timeout in case bufferedamountlow event is delayed
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        channel.removeEventListener("bufferedamountlow", onLow);
        resolve();
      }
    }, 250);
  });
}

/**
 * Computes SHA-256 hash hex string of an ArrayBuffer or Uint8Array.
 */
export async function computeSHA256(
  data: ArrayBuffer | Uint8Array,
): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    data as unknown as BufferSource,
  );
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Safely converts a Blob or File to an ArrayBuffer across both browser and jsdom environments.
 */
export async function blobToArrayBuffer(
  blob: Blob | File,
): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () =>
      reject(reader.error || new Error("Failed reading blob"));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Computes SHA-256 checksum of a File.
 */
export async function computeFileSHA256(file: File): Promise<string> {
  const buffer = await blobToArrayBuffer(file);
  return computeSHA256(buffer);
}

/**
 * Slices a single 64KB chunk from a File on demand.
 */
export async function sliceFileChunk(
  file: File,
  chunkIndex: number,
  chunkSize: number = P2P_CHUNK_SIZE,
): Promise<ArrayBuffer> {
  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize, file.size);
  const blobSlice = file.slice(start, end);
  return blobToArrayBuffer(blobSlice);
}

/**
 * Serializes a 64KB ArrayBuffer chunk into a binary packet with header:
 * [Magic (1B), ID Length (1B), TransferId (NB), ChunkIndex (4B), TotalChunks (4B), Data]
 */
export function serializeBinaryChunkPacket(
  transferId: string,
  chunkIndex: number,
  totalChunks: number,
  chunkBuffer: ArrayBuffer,
): ArrayBuffer {
  const enc = new TextEncoder();
  const idBytes = enc.encode(transferId);
  const headerSize = 1 + 1 + idBytes.length + 4 + 4;
  const packetBuffer = new ArrayBuffer(headerSize + chunkBuffer.byteLength);
  const view = new DataView(packetBuffer);
  const u8 = new Uint8Array(packetBuffer);

  // Magic
  view.setUint8(0, BINARY_PACKET_MAGIC);
  // ID length
  view.setUint8(1, idBytes.length);
  // ID bytes
  u8.set(idBytes, 2);

  let offset = 2 + idBytes.length;
  // Chunk index
  view.setUint32(offset, chunkIndex, false);
  offset += 4;
  // Total chunks
  view.setUint32(offset, totalChunks, false);
  offset += 4;

  // Payload
  u8.set(new Uint8Array(chunkBuffer), offset);
  return packetBuffer;
}

/**
 * Deserializes a binary packet received over RTCDataChannel.
 */
export function deserializeBinaryChunkPacket(packetBuffer: ArrayBuffer): {
  transferId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkData: Uint8Array;
} | null {
  if (packetBuffer.byteLength < 12) return null;
  const view = new DataView(packetBuffer);
  if (view.getUint8(0) !== BINARY_PACKET_MAGIC) return null;

  const idLen = view.getUint8(1);
  if (packetBuffer.byteLength < 2 + idLen + 8) return null;

  const dec = new TextDecoder();
  const idBytes = new Uint8Array(packetBuffer, 2, idLen);
  const transferId = dec.decode(idBytes);

  let offset = 2 + idLen;
  const chunkIndex = view.getUint32(offset, false);
  offset += 4;
  const totalChunks = view.getUint32(offset, false);
  offset += 4;

  const chunkData = new Uint8Array(packetBuffer, offset);
  return { transferId, chunkIndex, totalChunks, chunkData };
}

/**
 * Formats throughput into a human-readable string (e.g. "2.4 MB/s" or "450 KB/s").
 */
export function formatThroughput(speedMBps: number): string {
  if (speedMBps >= 1) {
    return `${speedMBps.toFixed(1)} MB/s`;
  }
  const speedKBps = speedMBps * 1024;
  return `${Math.round(speedKBps)} KB/s`;
}

/**
 * Formats ETA remaining seconds into human-readable string (e.g. "12s" or "1m 15s").
 */
export function formatETA(etaSeconds: number): string {
  if (etaSeconds <= 0) return "< 1s";
  if (etaSeconds < 60) return `${Math.ceil(etaSeconds)}s`;
  const minutes = Math.floor(etaSeconds / 60);
  const remainingSeconds = Math.ceil(etaSeconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
