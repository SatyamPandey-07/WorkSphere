/**
 * Web Worker for Offloaded Hybrid Venue Search Scoring (#5664)
 *
 * Offloads multi-metric scoring (semantic match, proximity, rating, full-text)
 * from the main UI thread to keep slider interactions fluid at 60fps.
 * Uses transferable ArrayBuffers for zero-copy data transfer.
 */

import {
  HybridScoringWeights,
  VenueScoringRecord,
  HybridSearchWorkerRequest,
  HybridSearchWorkerResponse,
  computeHybridScores,
  serializeVenuesToScoresBuffer,
} from "@/lib/search/hybridSearchWorkerEngine";

export type {
  HybridScoringWeights,
  VenueScoringRecord,
  HybridSearchWorkerRequest,
  HybridSearchWorkerResponse,
};
export { computeHybridScores, serializeVenuesToScoresBuffer };

// In-worker cached state
let cachedVenueIds: string[] = [];
let cachedScoresArray: Float32Array | null = null;
let cachedStride = 4;

// Worker message handling (runs inside Web Worker environment)
if (
  typeof self !== "undefined" &&
  typeof self.addEventListener === "function"
) {
  self.addEventListener(
    "message",
    (event: MessageEvent<HybridSearchWorkerRequest>) => {
      const message = event.data;
      if (!message) return;

      try {
        switch (message.type) {
          case "INDEX": {
            const { venueIds, scoresBuffer, stride = 4 } = message.payload;
            cachedVenueIds = venueIds;
            cachedScoresArray = new Float32Array(scoresBuffer);
            cachedStride = stride;

            const response: HybridSearchWorkerResponse = {
              type: "INDEX_SUCCESS",
              sequenceId: message.sequenceId,
              count: venueIds.length,
            };
            self.postMessage(response);
            break;
          }

          case "SCORE": {
            const { weights, venueIds, scoresBuffer, stride, limit } =
              message.payload;

            const activeIds = venueIds ?? cachedVenueIds;
            const activeScores = scoresBuffer
              ? new Float32Array(scoresBuffer)
              : cachedScoresArray;
            const activeStride = stride ?? cachedStride;

            if (!activeScores || activeIds.length === 0) {
              const emptyResponse: HybridSearchWorkerResponse = {
                type: "SCORE_SUCCESS",
                sequenceId: message.sequenceId,
                payload: {
                  sortedIds: [],
                  sortedIndicesBuffer: new Uint32Array(0).buffer as ArrayBuffer,
                  sortedScoresBuffer: new Float32Array(0).buffer as ArrayBuffer,
                  count: 0,
                  executionTimeMs: 0,
                },
              };
              self.postMessage(emptyResponse);
              return;
            }

            const result = computeHybridScores(
              activeIds,
              activeScores,
              weights,
              activeStride,
              limit,
            );

            const response: HybridSearchWorkerResponse = {
              type: "SCORE_SUCCESS",
              sequenceId: message.sequenceId,
              payload: {
                sortedIds: result.sortedIds,
                sortedIndicesBuffer: result.sortedIndicesBuffer,
                sortedScoresBuffer: result.sortedScoresBuffer,
                count: result.count,
                executionTimeMs: result.executionTimeMs,
              },
            };

            try {
              self.postMessage(response, [
                result.sortedIndicesBuffer,
                result.sortedScoresBuffer,
              ]);
            } catch {
              self.postMessage(response);
            }
            break;
          }

          case "CLEAR": {
            cachedVenueIds = [];
            cachedScoresArray = null;
            break;
          }
        }
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error ? err.message : "Scoring calculation failed";
        const errorResponse: HybridSearchWorkerResponse = {
          type: "ERROR",
          sequenceId:
            "sequenceId" in message && typeof message.sequenceId === "number"
              ? message.sequenceId
              : 0,
          error: errorMsg,
        };
        self.postMessage(errorResponse);
      }
    },
  );
}
