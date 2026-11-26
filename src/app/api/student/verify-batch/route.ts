import { NextRequest, NextResponse } from "next/server";
import {
  verifyBatchStudentDiscountProofs,
  BatchStudentDiscountRequest,
  BatchStudentDiscountResultItem,
  computeClusterMerkleHash,
} from "@/lib/zkp/batch";

export const dynamic = "force-dynamic";

/**
 * Checks whether the incoming request prefers NDJSON streaming.
 */
function isNdjsonPreferred(req: NextRequest): boolean {
  const accept = req.headers.get("accept") || "";
  return accept.includes("application/x-ndjson");
}

/**
 * Helper to check whether an error or signal represents client disconnection.
 */
function isAbortOrDisconnectError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!err) return false;
  if (typeof err === "object") {
    const error = err as Record<string, unknown>;
    const name = String(error.name || "");
    const code = String(error.code || "");
    const message = String(error.message || "").toLowerCase();

    if (
      name === "AbortError" ||
      code === "ABORT_ERR" ||
      code === "ECONNRESET" ||
      code === "ERR_STREAM_PREMATURE_CLOSE" ||
      message.includes("abort") ||
      message.includes("aborted") ||
      message.includes("closed") ||
      message.includes("cancel") ||
      message.includes("connection reset")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * POST /api/student/verify-batch
 *
 * Batch student discount verification endpoint supporting standard JSON responses
 * and incremental NDJSON streaming (application/x-ndjson).
 */
export async function POST(req: NextRequest) {
  try {
    let body: BatchStudentDiscountRequest;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body." },
        { status: 400 },
      );
    }

    const items = body?.items || body?.studentProofs;

    if (!body || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        {
          error: "Invalid request payload. 'items' or 'studentProofs' array is required.",
        },
        { status: 400 },
      );
    }

    const verification = await verifyBatchStudentDiscountProofs(
      body,
      req.signal,
    );

    if (req.signal.aborted) {
      return new Response(null, { status: 499 });
    }

        const abortHandler = () => {
          safeClose();
        };

        if (req.signal.aborted) {
          safeClose();
          return;
        }

        req.signal.addEventListener("abort", abortHandler, { once: true });

        try {
          const results: BatchStudentDiscountResultItem[] = [];
          let verifiedCount = 0;

          for (let index = 0; index < totalCount; index++) {
            if (isClosed || req.signal.aborted) break;

            const item = items[index];
            const itemId = item.id || item.studentId || `item-${index + 1}`;

            let itemResult: BatchStudentDiscountResultItem;

            try {
              // Verify individual item using batch verifier per item
              const singleItemBatch = {
                institutionId: body.institutionId,
                epoch: item.epoch ?? body.epoch,
                items: [item],
              };

              const singleVerify = await verifyBatchStudentDiscountProofs(singleItemBatch);
              const res = singleVerify.results[0];

              if (res) {
                itemResult = {
                  ...res,
                  index,
                  id: res.id || itemId,
                };
              } else {
                itemResult = {
                  index,
                  id: itemId,
                  userId: item.userId,
                  studentId: item.studentId,
                  valid: false,
                  discountEligible: false,
                  error: "Verification produced no result item",
                };
              }
            } catch (err: any) {
              itemResult = {
                index,
                id: itemId,
                userId: item.userId,
                studentId: item.studentId,
                valid: false,
                discountEligible: false,
                error: err?.message || "Item verification failed",
              };
            }

            if (itemResult.valid) {
              verifiedCount++;
            }
            results.push(itemResult);

            const progress = {
              current: index + 1,
              total: totalCount,
              percentage: Math.round(((index + 1) / totalCount) * 100),
            };

            safeEnqueue({
              type: "progress",
              item: itemResult,
              progress,
            });
          }

          if (!isClosed && !req.signal.aborted) {
            const batchHash = computeClusterMerkleHash(
              items.map((it, i) => it.id || it.studentId || it.userId || String(i)),
            );

            const completion = {
              valid: verifiedCount === totalCount && totalCount > 0,
              verifiedCount,
              failedCount: totalCount - verifiedCount,
              totalCount,
              results,
              batchHash,
            };

            safeEnqueue({
              type: "complete",
              data: completion,
            });

            safeClose();
          }
        } catch (streamErr: any) {
          if (!isAbortOrDisconnectError(streamErr, req.signal)) {
            console.error("[BATCH_STUDENT_DISCOUNT_STREAM_ERROR]", streamErr);
            safeEnqueue({
              type: "error",
              error: streamErr?.message || "Internal stream processing error",
            });
            safeClose();
          }
        } finally {
          req.signal.removeEventListener("abort", abortHandler);
        }
      },
      cancel() {
        // Stream cancelled by consumer
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Transfer-Encoding": "chunked",
        Connection: "keep-alive",
      },
    });
  } catch (err: any) {
    console.error("[BATCH_STUDENT_DISCOUNT_VERIFY_ERROR]", err);
    return NextResponse.json(
      {
        error:
          err?.message ||
          "Failed to process batch student discount verification.",
      },
      { status: 500 },
    );
  }
}
