export interface DataChannelLike {
  bufferedAmount: number;
  bufferedAmountLowThreshold?: number;
  send(data: string): void;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export interface ChunkFrame {
  type: 'WS_CHUNK';
  version: number;
  messageId: string;
  seq: number;
  totalChunks: number;
  checksum: string;
  data: string;
}

export interface ChunkerOptions {
  chunkSizeBytes?: number;
  highWaterMarkBytes?: number;
  lowWaterMarkBytes?: number;
  version?: number;
  pollIntervalMs?: number;
}

export interface ReassemblyOptions {
  ttlMs?: number;
  maxPendingMessages?: number;
}

export function computeChecksum(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function chunkPayload(
  payload: string,
  messageId: string,
  options: Pick<ChunkerOptions, 'chunkSizeBytes' | 'version'> = {}
): ChunkFrame[] {
  const chunkSize = Math.max(256, options.chunkSizeBytes ?? 16 * 1024);
  const version = options.version ?? 1;
  const checksum = computeChecksum(payload);

  if (payload.length === 0) {
    return [
      {
        type: 'WS_CHUNK',
        version,
        messageId,
        seq: 0,
        totalChunks: 1,
        checksum,
        data: '',
      },
    ];
  }

  const totalChunks = Math.ceil(payload.length / chunkSize);
  const frames: ChunkFrame[] = [];

  for (let seq = 0; seq < totalChunks; seq++) {
    const start = seq * chunkSize;
    const end = Math.min(payload.length, start + chunkSize);
    frames.push({
      type: 'WS_CHUNK',
      version,
      messageId,
      seq,
      totalChunks,
      checksum,
      data: payload.slice(start, end),
    });
  }

  return frames;
}

export function parseChunkFrame(raw: string | ChunkFrame): ChunkFrame | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
      parsed &&
      parsed.type === 'WS_CHUNK' &&
      typeof parsed.messageId === 'string' &&
      typeof parsed.seq === 'number' &&
      typeof parsed.totalChunks === 'number' &&
      typeof parsed.checksum === 'string' &&
      typeof parsed.data === 'string' &&
      parsed.seq >= 0 &&
      parsed.totalChunks >= 1 &&
      parsed.seq < parsed.totalChunks
    ) {
      return parsed as ChunkFrame;
    }
    return null;
  } catch {
    return null;
  }
}

async function waitForBufferDrain(
  channel: DataChannelLike,
  lowWaterMark: number,
  pollIntervalMs: number
): Promise<void> {
  if (channel.bufferedAmount <= lowWaterMark) {
    return;
  }

  if (typeof channel.bufferedAmountLowThreshold === 'number') {
    channel.bufferedAmountLowThreshold = lowWaterMark;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (typeof channel.removeEventListener === 'function') {
        channel.removeEventListener('bufferedamountlow', onDrain);
      }
    };

    const onDrain = () => {
      if (settled) return;
      if (channel.bufferedAmount <= lowWaterMark) {
        settled = true;
        cleanup();
        resolve();
      }
    };

    if (typeof channel.addEventListener === 'function') {
      channel.addEventListener('bufferedamountlow', onDrain);
    }

    timer = setInterval(onDrain, pollIntervalMs);
  });
}

export async function sendWithBackpressure(
  channel: DataChannelLike,
  payload: string,
  messageId: string,
  options: ChunkerOptions = {}
): Promise<{ chunksSent: number; pauses: number }> {
  const highWaterMark = options.highWaterMarkBytes ?? 64 * 1024;
  const lowWaterMark = Math.min(
    highWaterMark,
    options.lowWaterMarkBytes ?? 16 * 1024
  );
  const pollIntervalMs = Math.max(5, options.pollIntervalMs ?? 15);

  const frames = chunkPayload(payload, messageId, options);
  let pauses = 0;

  for (const frame of frames) {
    if (channel.bufferedAmount > highWaterMark) {
      pauses += 1;
      await waitForBufferDrain(channel, lowWaterMark, pollIntervalMs);
    }
    channel.send(JSON.stringify(frame));
  }

  return { chunksSent: frames.length, pauses };
}

interface PendingMessageState {
  totalChunks: number;
  checksum: string;
  chunks: Map<number, string>;
  updatedAt: number;
}

export class ReassemblyBuffer {
  private readonly ttlMs: number;
  private readonly maxPendingMessages: number;
  private readonly pending = new Map<string, PendingMessageState>();

  constructor(options: ReassemblyOptions = {}) {
    this.ttlMs = Math.max(100, options.ttlMs ?? 30_000);
    this.maxPendingMessages = Math.max(10, options.maxPendingMessages ?? 256);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  gc(now = Date.now()): number {
    let evicted = 0;
    for (const [messageId, state] of this.pending.entries()) {
      if (now - state.updatedAt >= this.ttlMs) {
        this.pending.delete(messageId);
        evicted += 1;
      }
    }
    return evicted;
  }

  ingest(
    raw: string | ChunkFrame,
    now = Date.now()
  ): { status: 'INCOMPLETE' | 'COMPLETE' | 'INVALID' | 'CHECKSUM_MISMATCH'; payload?: string } {
    this.gc(now);

    const frame = parseChunkFrame(raw);
    if (!frame) {
      return { status: 'INVALID' };
    }

    let state = this.pending.get(frame.messageId);
    if (!state) {
      if (this.pending.size >= this.maxPendingMessages) {
        const oldestKey = this.pending.keys().next().value;
        if (oldestKey !== undefined) {
          this.pending.delete(oldestKey);
        }
      }
      state = {
        totalChunks: frame.totalChunks,
        checksum: frame.checksum,
        chunks: new Map<number, string>(),
        updatedAt: now,
      };
      this.pending.set(frame.messageId, state);
    }

    if (state.totalChunks !== frame.totalChunks || state.checksum !== frame.checksum) {
      this.pending.delete(frame.messageId);
      return { status: 'CHECKSUM_MISMATCH' };
    }

    state.chunks.set(frame.seq, frame.data);
    state.updatedAt = now;

    if (state.chunks.size < state.totalChunks) {
      return { status: 'INCOMPLETE' };
    }

    const parts: string[] = [];
    for (let i = 0; i < state.totalChunks; i++) {
      const part = state.chunks.get(i);
      if (part === undefined) {
        return { status: 'INCOMPLETE' };
      }
      parts.push(part);
    }

    this.pending.delete(frame.messageId);
    const assembled = parts.join('');

    if (computeChecksum(assembled) !== state.checksum) {
      return { status: 'CHECKSUM_MISMATCH' };
    }

    return { status: 'COMPLETE', payload: assembled };
  }
}