# DataChannel Chunking Runbook

Developer guide to how WorkSphere splits large binary messages into frames for
`RTCDataChannel`, how the receiver puts them back together, and how flow control
and cleanup behave.

**Source files**

- [`src/core/p2p/DataChannelChunker.ts`](../../src/core/p2p/DataChannelChunker.ts): sender side queue, chunking entry point, backpressure
- [`src/lib/crdt/dataChannelFraming.ts`](../../src/lib/crdt/dataChannelFraming.ts): frame encoder, decoder, `CrdtFrameReassembler`
- [`docs/crdt/CRDT_DATACHANNEL_FRAMING.md`](../crdt/CRDT_DATACHANNEL_FRAMING.md): header contract
- [`docs/architecture/WEBRTC_DATACHANNEL_FRAMING.md`](../architecture/WEBRTC_DATACHANNEL_FRAMING.md): broader framing spec

---

## 1. Overview

`DataChannelChunker` does not build frames itself. When `enqueue()` is called it
hands the payload to `encodeCrdtFrames()`, pushes the resulting frames onto a FIFO
queue, and drains that queue into `channel.send()` while respecting buffer limits.
The receiver feeds each raw message into a `CrdtFrameReassembler`, which validates the
frame and returns the full payload once every chunk has arrived.

```
sender                                              receiver
------                                              --------
payload (Uint8Array)
  |  encodeCrdtFrames()
  v
frame[0..n-1]  --> FIFO queue --> channel.send() --> onmessage(raw)
                   (backpressure)                      |  decodeCrdtFrame()
                                                       v
                                              CrdtFrameReassembler.pushFrame()
                                                       |
                                                       v
                                            ReassembledCrdtMessage | null
```

## 2. Frame format

Every frame is a fixed 16 byte header followed by `payloadLength` bytes of payload.
All multi byte fields are big endian.

```
 0               1               2               3
 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7
+---------------------------------+---------------+---------------+
|        magic (0x5753 "WS")      |    version    |     flags     |
+---------------------------------+---------------+---------------+
|                          messageId (uint32)                     |
+-----------------------------------+-----------------------------+
|        chunkIndex (uint16)        |      totalChunks (uint16)   |
+-----------------------------------+-----------------------------+
|        payloadLength (uint16)     |        crc16 (uint16)       |
+-----------------------------------+-----------------------------+
|                    payload (payloadLength bytes)                |
+-----------------------------------------------------------------+
```

| Offset | Size | Field | Notes |
|-------:|-----:|-------|-------|
| 0 | 2 | `magic` | `CRDT_FRAME_MAGIC` = `0x5753` |
| 2 | 1 | `version` | `CRDT_FRAME_VERSION` = `1`, other values are rejected |
| 3 | 1 | `flags` | low nibble is the message type, see below |
| 4 | 4 | `messageId` | transfer identifier shared by all chunks of one message |
| 8 | 2 | `chunkIndex` | zero based position of this chunk |
| 10 | 2 | `totalChunks` | chunk count for the message, at least 1 |
| 12 | 2 | `payloadLength` | bytes after the header |
| 14 | 2 | `crc16` | CRC-16/CCITT-FALSE (poly `0x1021`, init `0xFFFF`) over the payload only |

**Flags byte** (`CrdtFrameFlags`)

| Bits | Mask | Meaning |
|------|------|---------|
| 0 to 3 | `0x0f` (`TYPE_MASK`) | `CrdtFrameMessageType`: `STATE_VECTOR` 0x01, `DELTA_UPDATE` 0x02, `FULL_SYNC_FALLBACK` 0x03, `ACK` 0x04 |
| 4 | `0x10` | `COMPRESSED` |
| 5 | `0x20` | `END_OF_MESSAGE`, set only on the last chunk |

**Size constants**

| Constant | Value |
|----------|------:|
| `CRDT_FRAME_HEADER_SIZE` | 16 |
| `CRDT_MAX_SCTP_MESSAGE_SIZE` | 65,536 (64 KiB) |
| `CRDT_MAX_CHUNK_PAYLOAD_SIZE` | 65,520 |
| `CRDT_MAX_CHUNKS_SOFT_CAP` | 256 (about 16 MiB) |

`encodeCrdtFrames()` throws a `RangeError` if a payload needs more than 65,535 chunks
(the `uint16` limit). A caller can lower the per chunk payload with
`EnqueueOptions.maxChunkPayloadSize`, but it is clamped to
`CRDT_MAX_CHUNK_PAYLOAD_SIZE`, so a smaller value only produces more, smaller frames.

## 3. MTU considerations

The framing layer targets a ceiling of 64 KiB per message, and
`decodeCrdtFrame()` rejects anything larger. Frames are sent as complete
`RTCDataChannel` messages, so the browser and SCTP handle fragmentation below this layer.

- **Reliable and ordered channels** (for example `{ ordered: true }`, as used by
  `WebRTCMesh.ts`): frames arrive in order and without loss. Chunking exists to keep
  individual messages bounded, not to repair delivery.
- **Unordered or partially reliable channels** (`ordered: false`, `maxRetransmits`,
  `maxPacketLifeTime`): frames can arrive out of order or never arrive. The reassembler
  tolerates reordering and duplicate chunks, but it has no retransmission and no
  built in timeout, so a lost chunk leaves the message pending until it is evicted
  (see section 6). Prefer reliable channels for CRDT traffic.
- Interoperability across browsers is best when messages stay at or below 64 KiB,
  which is why the cap sits at that value.

## 4. Sender side: queueing and backpressure

Constants exported from `DataChannelChunker.ts`:

| Constant | Value | Purpose |
|----------|------:|---------|
| `HIGH_WATER_MARK` | 1 MiB (1,048,576) | stop sending when `bufferedAmount + nextFrameSize` would exceed this |
| `LOW_WATER_MARK` | 64 KiB (65,536) | assigned to `channel.bufferedAmountLowThreshold` |
| `DEFAULT_MAX_QUEUE_BYTES` | 16 MiB | queue capacity in bytes |
| `DEFAULT_MAX_QUEUE_FRAMES` | 10,000 | queue capacity in frames |

Behavior of `enqueue(data, options)`:

1. Pick a `messageId`. If `options.messageId` is absent, an internal counter is used,
   starting at 1, wrapping as `uint32`, and skipping 0.
2. Encode frames with `encodeCrdtFrames()`. Defaults: `messageType` is
   `DELTA_UPDATE` and `compressed` is `true`.
3. If the queue would exceed `maxQueueBytes` or `maxQueueFrames`, either throw
   `QueueOverflowError` (`overflowPolicy: "throw"`, the default) or call `onError` and
   return `false` (`overflowPolicy: "drop"`). Nothing is partially queued, the whole
   message is accepted or rejected.
4. Push all frames, then call `drainQueue()`.

`drainQueue()`:

- returns immediately when the chunker is disposed, already draining, or the channel
  `readyState` is not `"open"`
- before each send, checks `bufferedAmount + nextFrameSize > highWaterMark`; if true it
  sets the backpressured flag and stops
- calls `channel.send()` and only then removes the frame from the queue, so order is
  strictly FIFO and nothing is dropped
- on an `OperationError` (send buffer saturated) keeps the frame at the head of the queue,
  marks backpressure and waits
- any other send error is passed to `onError` and rethrown

Resumption happens on the `bufferedamountlow` event: the handler clears the
backpressured flag when `bufferedAmount <= lowWaterMark` and calls `drainQueue()`
again. The `open` event also triggers a drain, which flushes frames queued before the
channel opened.

`getMetrics()` returns `DataChannelChunkerMetrics`: `queuedFrames`, `queuedBytes`,
`isBackpressured`, `totalMessagesEnqueued`, `totalFramesSent`, `totalBytesSent`.

## 5. Receiver side: reassembly state machine

`CrdtFrameReassembler.pushFrame(raw)` returns `ReassembledCrdtMessage | null`.

```
                 pushFrame(raw)
                      |
              decodeCrdtFrame()  --(invalid)--> throws Error
                      |
        messageId in completed set? --yes--> return null (replay dropped)
                      |
        totalChunks == 1 && chunkIndex == 0? --yes--> mark completed, return message
                      |
            pending.get(messageId)
              |                 |
          not found           found
              |                 |
   pending >= max (64)?     totalChunks differs? --yes--> delete entry, throw
     yes: evict oldest          |
              |                 no
   create PendingAssembly       |
              \_________________/
                      |
        chunk slot empty? --yes--> store copy, receivedCount++
                      |            (duplicate chunk: ignored)
        receivedCount < totalChunks? --yes--> return null
                      |
                      no
                      |
   delete pending, mark completed, concatenate chunks in index order
                      |
              return ReassembledCrdtMessage
```

Validation order inside `decodeCrdtFrame()`:

1. length at least 16 bytes
2. length at most 65,536 bytes
3. magic equals `0x5753`
4. version equals `1`
5. `totalChunks` is not 0 and `chunkIndex < totalChunks`
6. `16 + payloadLength` equals the buffer length
7. CRC-16 of the payload matches the header

Every failure throws an `Error`. The caller should catch it and drop the frame.

**Types** (as exported by `dataChannelFraming.ts`)

```ts
interface DecodedCrdtFrame {
  magic: number;
  version: number;
  flags: number;
  messageType: CrdtFrameMessageType;
  messageId: number;
  chunkIndex: number;
  totalChunks: number;
  payloadLength: number;
  crc16: number;
  payload: Uint8Array;
}

interface ReassembledCrdtMessage {
  messageId: number;
  messageType: CrdtFrameMessageType;
  flags: number;
  payload: Uint8Array;
}
```

Notes:

- The message type and flags come from the first chunk seen for a `messageId`, so the
  reassembled `flags` may not include `END_OF_MESSAGE` if the last chunk arrived later.
- Completion is based on `receivedCount === totalChunks`, not on the
  `END_OF_MESSAGE` flag, so out of order arrival is fine.
- Replay protection keeps the most recent 512 completed `messageId` values.

## 6. Eviction and cleanup

What the code does today:

| Situation | Behavior |
|-----------|----------|
| More than `maxPendingMessages` (default 64) partial messages | oldest pending assembly is evicted (insertion order) |
| `totalChunks` changes mid transfer | the assembly is deleted and an `Error` is thrown |
| Channel `close` event | `DataChannelChunker.dispose()` runs: listeners removed, queue and queued byte count cleared, backpressure flag reset |
| Peer disconnects or the session ends | the owner of the reassembler should call `CrdtFrameReassembler.clear()`, which drops all pending assemblies and the completed id set |
| Sender queue full | `QueueOverflowError` or `onError` plus `false`, see section 4 |

Important: `PendingAssembly` records `createdAt`, but `CrdtFrameReassembler` does not
currently expire partial transfers by age. A stalled transfer stays in memory until
it is evicted by the 64 entry limit or `clear()` is called. Code that needs a timeout
(for example on a partially reliable channel) must enforce it outside the reassembler,
for instance by calling `clear()` when the peer is declared gone.

Also note that `dispose()` discards frames that were queued but not yet sent. After a
reconnect the sender must enqueue the message again with a fresh `DataChannelChunker`.

## 7. Operational checklist

- Inspect `getMetrics()` for growing `queuedBytes` or a permanently true `isBackpressured`.
- A `CRC-16 mismatch` error points to corruption or a sender that built frames by hand.
- `Inconsistent totalChunks` means two senders are reusing a `messageId`. Use one
  chunker per channel, or pass explicit unique ids.
- Existing regression coverage:
  `src/__tests__/core/p2p/DataChannelChunker.backpressure.test.ts`.
