/**
 * route.ts

 * API endpoint that accepts offline sync payloads and returns server-diff patches.
 * Integrates causal dependency buffering via OfflineMutationQueue to resolve
 * vector clock forks from disconnected offline mutation reordering (#9636).
 */

import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import {
  OfflineMutationQueue,
  OfflineMutation,
} from "@/core/sync/OfflineMutationQueue";

/** Max compressed request size: 1 MB */
export const MAX_COMPRESSED_BODY_BYTES = 1024 * 1024;
/** Max decompressed payload size: 10 MB (prevents gzip bomb attacks) */
export const MAX_DECOMPRESSED_BODY_BYTES = 10 * 1024 * 1024;

export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

export class DecompressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecompressionError";
  }
}

/**
 * Streams and decompresses an incoming request body using node:zlib createGunzip().
 * Enforces strict input and output byte bounds to guard against decompression bombs.
 */
export async function decompressGzipStream(
  request: NextRequest,
  maxInputBytes = MAX_COMPRESSED_BODY_BYTES,
  maxOutputBytes = MAX_DECOMPRESSED_BODY_BYTES,
): Promise<string> {
  const reqBody = request.body;
  if (!reqBody) {
    return "";
  }

  let nodeStream: Readable;
  if (Buffer.isBuffer(reqBody) || reqBody instanceof Uint8Array) {
    nodeStream = Readable.from(reqBody);
  } else if (typeof (reqBody as any).getReader === "function") {
    nodeStream = Readable.fromWeb(reqBody as any);
  } else if (typeof (reqBody as any).pipe === "function") {
    nodeStream = reqBody as unknown as Readable;
  } else {
    throw new DecompressionError("Unsupported request body stream type");
  }

  const gunzip = createGunzip();
  let inBytes = 0;
  let outBytes = 0;

  nodeStream.on("data", (chunk: Buffer | Uint8Array) => {
    inBytes += chunk.length;
    if (inBytes > maxInputBytes) {
      const err = new PayloadTooLargeError(
        `Compressed payload exceeded maximum allowed size of ${maxInputBytes} bytes`,
      );
      nodeStream.destroy(err);
      gunzip.destroy(err);
    }
  });

  gunzip.on("data", (chunk: Buffer | Uint8Array) => {
    outBytes += chunk.length;
    if (outBytes > maxOutputBytes) {
      const err = new PayloadTooLargeError(
        `Decompressed payload exceeded maximum allowed size of ${maxOutputBytes} bytes`,
      );
      nodeStream.destroy(err);
      gunzip.destroy(err);
    }
  });

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    gunzip.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    gunzip.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    gunzip.on("error", (err) => {
      if (err instanceof PayloadTooLargeError) {
        reject(err);
      } else {
        reject(new DecompressionError(`Failed to decompress gzip stream: ${err.message}`));
      }
    });
    nodeStream.on("error", (err) => {
      if (err instanceof PayloadTooLargeError) {
        reject(err);
      } else {
        reject(new DecompressionError(`Input stream error: ${err.message}`));
      }
    });

    nodeStream.pipe(gunzip);
  });
}

// In-memory sync queues and states indexed by booking/draft ID
const bookingQueues = new Map<
  string,
  OfflineMutationQueue<Record<string, unknown>>
>();
const bookingStates = new Map<
  string,
  { id: string; version: number; payload: Record<string, unknown> }
>();

/**
 * Retrieves or initializes the OfflineMutationQueue for a given booking ID.
 */
export function getBookingMutationQueue(
  bookingId: string,
): OfflineMutationQueue<Record<string, unknown>> {
  let queue = bookingQueues.get(bookingId);
  if (!queue) {
    queue = new OfflineMutationQueue<Record<string, unknown>>({
      nodeId: "server",
    });
    bookingQueues.set(bookingId, queue);
  }
  return queue;
}

/**
 * Resets queues and states (used for test isolation).
 */
export function resetBookingMutationQueues(): void {
  bookingQueues.clear();
  bookingStates.clear();
}

/**
 * Server-authoritative offline booking synchronization with optimistic concurrency control.
 */

export async function POST(request: NextRequest) {
  try {
    const contentEncoding = (
      request.headers.get("content-encoding") || ""
    ).toLowerCase().trim();

    let body: any;

    if (contentEncoding === "gzip") {
      try {
        const decompressedText = await decompressGzipStream(request);
        if (!decompressedText) {
          return NextResponse.json(
            { error: "Decompressed request body is empty" },
            { status: 400 },
          );
        }
        body = JSON.parse(decompressedText);
      } catch (err: any) {
        if (err instanceof PayloadTooLargeError) {
          return NextResponse.json(
            { error: "Payload Too Large: " + err.message },
            { status: 413 },
          );
        }
        return NextResponse.json(
          { error: "Bad Request: Invalid gzip compressed data" },
          { status: 400 },
        );
      }
    } else if (contentEncoding === "" || contentEncoding === "identity") {
      body = await request.json();
    } else {
      return NextResponse.json(
        {
          error: `Unsupported Media Type: Unsupported Content-Encoding '${contentEncoding}'. Supported: 'gzip', 'identity'`,
        },
        { status: 415 },
      );
    }

    const { draftId, draftPayload } = body || {};

    if (!draftId || !draftPayload || typeof draftPayload !== "object") {
      return NextResponse.json(
        { error: "Missing draftId or draftPayload" },
        { status: 400 },
      );
    }

    const clientId = body.clientId || body.nodeId || body.userId || "client";
    const queue = getBookingMutationQueue(draftId);

    // Retrieve or initialize server state
    const currentServerState = bookingStates.get(draftId) || {
      id: draftId,
      version: body.serverVersion || 0,
      payload: { status: "PENDING" },
    };

    // Construct OfflineMutation record
    const vectorClock: Record<string, number> = body.vectorClock || {
      [clientId]: (queue.getLocalClock()[clientId] || 0) + 1,
    };

    const mutationId =
      body.mutationId ||
      (body.draftId && body.id ? body.id : null) ||
      `${draftId}-${clientId}-${vectorClock[clientId] || Date.now()}`;

    const mutation: OfflineMutation<Record<string, unknown>> = {
      id: mutationId,
      clientId,
      vectorClock,
      parentClock: body.parentClock,
      payload: draftPayload,
      timestamp: body.timestamp || Date.now(),
      metadata: body.metadata,
    };

    // 2. Enqueue through causal dependency queue
    const result = queue.enqueue(mutation);

    if (result.status === "BUFFERED") {
      return NextResponse.json(
        {
          success: true,
          action: "BUFFERED",
          buffered: true,
          mutationId: mutation.id,
          bufferedCount: result.bufferedCount,
          currentClock: result.currentClock,
          message:
            "Mutation buffered in pending dependency pool awaiting predecessor mutations.",
        },
        { status: 200 },
      );
    }

    if (result.status === "DUPLICATE") {
      return NextResponse.json(
        {
          success: true,
          action: "DUPLICATE",
          mutationId: mutation.id,
          bufferedCount: result.bufferedCount,
          currentClock: result.currentClock,
          message: result.reason || "Mutation already applied or stale",
        },
        { status: 200 },
      );
    }

    // 3. Status is 'APPLIED': Apply all newly unblocked mutations in causal order
    let updatedPayload = { ...currentServerState.payload };
    for (const applied of result.appliedMutations) {
      if (applied.payload && typeof applied.payload === "object") {
        updatedPayload = { ...updatedPayload, ...applied.payload };
      }
      currentServerState.version += 1;
    }

    currentServerState.payload = updatedPayload;
    bookingStates.set(draftId, currentServerState);

    return NextResponse.json(
      {
        success: true,
        action: "MERGED",
        appliedMutations: result.appliedMutations,
        resolvedPayload: currentServerState.payload,
        newVersion: currentServerState.version,
        vectorClock: result.currentClock,
        bufferedCount: result.bufferedCount,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Booking sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
