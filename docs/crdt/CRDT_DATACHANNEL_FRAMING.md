# CRDT WebRTC DataChannel Framing & Chunking Protocol

## 1. Overview

Collaborative whiteboard sessions in WorkSphere synchronize Conflict-Free Replicated Data Type (CRDT) updates—such as Yjs document deltas, stroke vector batches, and cursor awareness states—peer-to-peer over WebRTC `RTCDataChannel` connections.

Because WebRTC DataChannels operate over Stream Control Transmission Protocol (SCTP) encapsulated in DTLS/UDP, transmitting unfragmented binary deltas that exceed the negotiated SCTP maximum message size results in silent frame drops, channel resets, or `OperationError` exceptions across browsers. This specification defines the binary packet layout, 64 KiB chunking boundaries, sequence tracking, reassembly state machine, and relay fallback pathways used by the whiteboard sync layer.

---

## 2. MTU & SCTP Boundary Assumptions

| Parameter                               | Value                          | Rationale                                                                                                                    |
| :-------------------------------------- | :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| **Underlying IP Path MTU**              | `1,200 bytes`                  | Conservative WebRTC DTLS-SRTP path MTU ceiling to prevent IP-layer fragmentation across VPNs and mobile networks.            |
| **Browser SCTP `maxMessageSize` Floor** | `65,536 bytes` (`64 KiB`)      | Lowest common denominator across Chromium, Firefox, and Safari when SDP `a=max-message-size` is omitted or capped.           |
| **Frame Header Size**                   | `16 bytes`                     | Fixed-width big-endian binary header prepended to every DataChannel message.                                                 |
| **Maximum Chunk Payload Size**          | `65,520 bytes` (`65,536 - 16`) | Ensures the complete SCTP user message never exceeds `65,536` bytes.                                                         |
| **Maximum Chunks per Message**          | `65,535` (`uint16` max)        | Theoretical upper bound (`~4.29 GiB`); practical whiteboard soft cap is `256` chunks (`16 MiB`).                             |
| **Channel Delivery Mode**               | `ordered: true`                | Reliable, ordered SCTP delivery (`maxRetransmits` unset) guarantees in-order chunk arrival per channel without custom NACKs. |

> **Cross-Browser Interoperability Rule:** Even when `RTCSctpTransport.maxMessageSize` reports a larger limit (such as `262,144` bytes in Chromium), senders **must** clamp total outgoing frames to `65,536` bytes (`16`-byte header + `65,520`-byte payload) so heterogeneous browser peers decode frames reliably.

---

## 3. Binary Packet Layout & Header Byte Offsets

All frames transmitted via `RTCDataChannel.send(ArrayBuffer)` use a **16-byte fixed header** encoded in **Network Byte Order (Big-Endian)**.

### Wire Format Diagram

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Magic (0x5753)        |    Version    |     Flags     |  Bytes 0..3
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          Message ID                           |  Bytes 4..7
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Chunk Index          |          Total Chunks         |  Bytes 8..11
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Payload Length        |         CRC-16/CCITT          |  Bytes 12..15
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                CRDT Delta Payload (0..65,520 bytes)           |  Bytes 16..N
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```
