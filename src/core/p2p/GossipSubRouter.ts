export enum PacketPriority {
  EMERGENCY = 0,
  SAFETY_ALERT = 1,
  CRDT_SYNC = 2,
  TELEMETRY = 3,
}

export interface GossipPacket<TPayload = unknown> {
  id: string;
  topic: string;
  priority: PacketPriority;
  payload: TPayload;
  enqueuedAt: number;
  expiresAt: number;
  byteSize?: number;
}

export interface DataChannelLike {
  readyState?: RTCDataChannelState | string;
  bufferedAmount: number;
  maxBufferedAmount?: number;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
}

export interface GossipSubRouterOptions {
  maxQueueSize?: number;
  defaultTtlMs?: Record<PacketPriority, number>;
  congestionRatio?: number;
  fallbackMaxBufferBytes?: number;
  now?: () => number;
}

export interface EnqueuePacketInput<TPayload = unknown> {
  id: string;
  topic: string;
  priority: PacketPriority;
  payload: TPayload;
  ttlMs?: number;
  byteSize?: number;
}

const DEFAULT_TTL_BY_PRIORITY: Record<PacketPriority, number> = {
  [PacketPriority.EMERGENCY]: 30_000,
  [PacketPriority.SAFETY_ALERT]: 15_000,
  [PacketPriority.CRDT_SYNC]: 5_000,
  [PacketPriority.TELEMETRY]: 1_500,
};

export class GossipSubRouter {
  private readonly maxQueueSize: number;
  private readonly defaultTtlMs: Record<PacketPriority, number>;
  private readonly congestionRatio: number;
  private readonly fallbackMaxBufferBytes: number;
  private readonly now: () => number;
  private queue: GossipPacket[] = [];
  private expiredCount = 0;
  private droppedByBackpressureCount = 0;

  constructor(options: GossipSubRouterOptions = {}) {
    this.maxQueueSize = Math.max(1, options.maxQueueSize ?? 256);
    this.defaultTtlMs = {
      ...DEFAULT_TTL_BY_PRIORITY,
      ...(options.defaultTtlMs ?? {}),
    };
    this.congestionRatio = options.congestionRatio ?? 0.9;
    this.fallbackMaxBufferBytes = options.fallbackMaxBufferBytes ?? 1_048_576;
    this.now = options.now ?? (() => Date.now());
  }

  public purgeExpired(atTime = this.now()): number {
    const before = this.queue.length;
    if (before === 0) return 0;

    const kept: GossipPacket[] = [];
    for (const pkt of this.queue) {
      if (pkt.expiresAt <= atTime) {
        this.expiredCount += 1;
      } else {
        kept.push(pkt);
      }
    }
    this.queue = kept;
    return before - this.queue.length;
  }

  public enqueue<TPayload>(input: EnqueuePacketInput<TPayload>): GossipPacket<TPayload> | null {
    const ts = this.now();
    this.purgeExpired(ts);

    const ttl = Math.max(1, input.ttlMs ?? this.defaultTtlMs[input.priority]);
    if (ttl <= 0) {
      this.expiredCount += 1;
      return null;
    }

    const packet: GossipPacket<TPayload> = {
      id: input.id,
      topic: input.topic,
      priority: input.priority,
      payload: input.payload,
      enqueuedAt: ts,
      expiresAt: ts + ttl,
      byteSize: input.byteSize,
    };

    if (this.queue.length >= this.maxQueueSize) {
      const evicted = this.evictLowestPriorityPacket(packet.priority);
      if (!evicted) {
        this.droppedByBackpressureCount += 1;
        return null;
      }
    }

    this.queue.push(packet);
    this.sortQueue();
    return packet;
  }

  public dequeue(atTime = this.now()): GossipPacket | undefined {
    this.purgeExpired(atTime);
    this.sortQueue();
    return this.queue.shift();
  }

  public peek(atTime = this.now()): GossipPacket | undefined {
    this.purgeExpired(atTime);
    this.sortQueue();
    return this.queue[0];
  }

  public isChannelCongested(channel: DataChannelLike): boolean {
    const capacity =
      channel.maxBufferedAmount && channel.maxBufferedAmount > 0
        ? channel.maxBufferedAmount
        : this.fallbackMaxBufferBytes;
    return channel.bufferedAmount >= capacity * this.congestionRatio;
  }

  public flushToChannel(
    channel: DataChannelLike,
    maxPacketsPerFlush = 64,
    atTime = this.now()
  ): GossipPacket[] {
    this.purgeExpired(atTime);
    this.sortQueue();

    const sent: GossipPacket[] = [];
    const congested = this.isChannelCongested(channel);

    const remaining: GossipPacket[] = [];
    for (const pkt of this.queue) {
      if (pkt.expiresAt <= atTime) {
        this.expiredCount += 1;
        continue;
      }

      const isUrgent =
        pkt.priority === PacketPriority.EMERGENCY ||
        pkt.priority === PacketPriority.SAFETY_ALERT;

      if (congested && !isUrgent) {
        if (pkt.priority === PacketPriority.TELEMETRY) {
          this.droppedByBackpressureCount += 1;
          continue;
        }
        remaining.push(pkt);
        continue;
      }

      if (sent.length >= maxPacketsPerFlush) {
        remaining.push(pkt);
        continue;
      }

      try {
        channel.send(JSON.stringify(pkt));
        sent.push(pkt);
      } catch {
        remaining.push(pkt);
      }
    }

    this.queue = remaining;
    this.sortQueue();
    return sent;
  }

  public size(atTime = this.now()): number {
    this.purgeExpired(atTime);
    return this.queue.length;
  }

  public getMetrics() {
    return {
      queued: this.queue.length,
      expiredCount: this.expiredCount,
      droppedByBackpressureCount: this.droppedByBackpressureCount,
    };
  }

  private evictLowestPriorityPacket(incomingPriority: PacketPriority): boolean {
    this.sortQueue();
    const lastIdx = this.queue.length - 1;
    if (lastIdx < 0) return false;
    const lowest = this.queue[lastIdx];
    if (lowest.priority > incomingPriority) {
      this.queue.splice(lastIdx, 1);
      this.droppedByBackpressureCount += 1;
      return true;
    }
    return false;
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      if (a.expiresAt !== b.expiresAt) {
        return a.expiresAt - b.expiresAt;
      }
      return a.enqueuedAt - b.enqueuedAt;
    });
  }
}