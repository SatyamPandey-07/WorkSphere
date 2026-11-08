"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  HybridScoringWeights,
  VenueScoringRecord,
  HybridSearchWorkerRequest,
  HybridSearchWorkerResponse,
  computeHybridScores,
  serializeVenuesToScoresBuffer,
  createDefaultHybridSearchWorker,
} from "@/lib/search/hybridSearchWorkerEngine";

export interface UseHybridSearchWorkerOptions {
  venues?: VenueScoringRecord[];
  preIndexedVenues?: {
    venueIds: string[];
    scoresBuffer: ArrayBuffer;
    stride?: number;
  };
  initialWeights?: HybridScoringWeights;
  onSortedIds?: (sortedIds: string[]) => void;
  onScoringComplete?: (result: {
    sortedIds: string[];
    executionTimeMs: number;
  }) => void;
  createWorker?: () => Worker | null;
  enabled?: boolean;
}

export interface UseHybridSearchWorkerReturn {
  sortedIds: string[];
  isScoring: boolean;
  executionTimeMs: number;
  error: string | null;
  score: (
    weights: HybridScoringWeights,
    overrideVenues?: VenueScoringRecord[],
  ) => void;
  indexVenues: (venues: VenueScoringRecord[]) => void;
  workerAvailable: boolean;
}

export function useHybridSearchWorker({
  venues,
  preIndexedVenues,
  initialWeights,
  onSortedIds,
  onScoringComplete,
  createWorker,
  enabled = true,
}: UseHybridSearchWorkerOptions = {}): UseHybridSearchWorkerReturn {
  const [sortedIds, setSortedIds] = useState<string[]>([]);
  const [isScoring, setIsScoring] = useState(false);
  const [executionTimeMs, setExecutionTimeMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const sequenceIdRef = useRef(0);
  const activeSequenceIdRef = useRef<number | null>(null);

  // Cached venue references for fallback or worker re-indexing
  const venuesRef = useRef<VenueScoringRecord[] | undefined>(venues);
  venuesRef.current = venues;

  const onSortedIdsRef = useRef(onSortedIds);
  onSortedIdsRef.current = onSortedIds;

  const onScoringCompleteRef = useRef(onScoringComplete);
  onScoringCompleteRef.current = onScoringComplete;

  // Initialize Worker
  useEffect(() => {
    if (
      !enabled ||
      typeof window === "undefined" ||
      typeof Worker === "undefined"
    ) {
      return;
    }

    try {
      const worker = createWorker
        ? createWorker()
        : createDefaultHybridSearchWorker();
      if (!worker) return;

      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<HybridSearchWorkerResponse>) => {
        const message = event.data;
        if (!message) return;

        if (
          activeSequenceIdRef.current !== null &&
          message.sequenceId < activeSequenceIdRef.current
        ) {
          // Discard stale out-of-order response
          return;
        }

        if (message.type === "SCORE_SUCCESS") {
          const { sortedIds: ids, executionTimeMs: timeMs } = message.payload;
          setSortedIds(ids);
          setExecutionTimeMs(timeMs);
          setIsScoring(false);
          setError(null);

          if (onSortedIdsRef.current) {
            onSortedIdsRef.current(ids);
          }
          if (onScoringCompleteRef.current) {
            onScoringCompleteRef.current({
              sortedIds: ids,
              executionTimeMs: timeMs,
            });
          }
        } else if (message.type === "INDEX_SUCCESS") {
          setIsScoring(false);
        } else if (message.type === "ERROR") {
          setError(message.error);
          setIsScoring(false);
        }
      };

      worker.onerror = (err) => {
        console.warn("hybridSearch.worker error:", err);
        setError("Worker scoring encountered an unexpected error.");
        setIsScoring(false);
      };

      return () => {
        worker.terminate();
        workerRef.current = null;
      };
    } catch (err) {
      console.warn("Failed to initialize hybridSearch.worker:", err);
    }
  }, [enabled, createWorker]);

  // Index venues when dataset changes
  const indexVenues = useCallback((data: VenueScoringRecord[]) => {
    const worker = workerRef.current;
    if (!data || data.length === 0) return;

    if (worker) {
      const { venueIds, scoresBuffer, stride } =
        serializeVenuesToScoresBuffer(data);
      const sequenceId = ++sequenceIdRef.current;

      const message: HybridSearchWorkerRequest = {
        type: "INDEX",
        sequenceId,
        payload: {
          venueIds,
          scoresBuffer,
          stride,
        },
      };

      try {
        worker.postMessage(message, [scoresBuffer]);
      } catch {
        worker.postMessage(message);
      }
    }
  }, []);

  // Synchronous scoring fallback when Web Worker is unavailable (e.g. SSR or test)
  const scoreSyncFallback = useCallback(
    (weights: HybridScoringWeights, venueList?: VenueScoringRecord[]) => {
      const targetVenues = venueList ?? venuesRef.current;
      if (!targetVenues || targetVenues.length === 0) {
        setSortedIds([]);
        return;
      }

      const { venueIds, scoresBuffer, stride } =
        serializeVenuesToScoresBuffer(targetVenues);
      const scoresArray = new Float32Array(scoresBuffer);

      const result = computeHybridScores(
        venueIds,
        scoresArray,
        weights,
        stride,
      );
      setSortedIds(result.sortedIds);
      setExecutionTimeMs(result.executionTimeMs);
      setIsScoring(false);

      if (onSortedIdsRef.current) {
        onSortedIdsRef.current(result.sortedIds);
      }
      if (onScoringCompleteRef.current) {
        onScoringCompleteRef.current({
          sortedIds: result.sortedIds,
          executionTimeMs: result.executionTimeMs,
        });
      }
    },
    [],
  );

  // Main scoring dispatch
  const score = useCallback(
    (weights: HybridScoringWeights, overrideVenues?: VenueScoringRecord[]) => {
      const worker = workerRef.current;
      const targetVenues = overrideVenues ?? venuesRef.current;

      if (!worker) {
        scoreSyncFallback(weights, targetVenues);
        return;
      }

      setIsScoring(true);
      setError(null);
      const sequenceId = ++sequenceIdRef.current;
      activeSequenceIdRef.current = sequenceId;

      if (overrideVenues && overrideVenues.length > 0) {
        const { venueIds, scoresBuffer, stride } =
          serializeVenuesToScoresBuffer(overrideVenues);
        const message: HybridSearchWorkerRequest = {
          type: "SCORE",
          sequenceId,
          payload: {
            weights,
            venueIds,
            scoresBuffer,
            stride,
          },
        };

        try {
          worker.postMessage(message, [scoresBuffer]);
        } catch {
          worker.postMessage(message);
        }
      } else {
        const message: HybridSearchWorkerRequest = {
          type: "SCORE",
          sequenceId,
          payload: {
            weights,
          },
        };
        worker.postMessage(message);
      }
    },
    [scoreSyncFallback],
  );

  // Pre-index when venues prop or preIndexedVenues prop change
  useEffect(() => {
    if (preIndexedVenues && workerRef.current) {
      const sequenceId = ++sequenceIdRef.current;
      const message: HybridSearchWorkerRequest = {
        type: "INDEX",
        sequenceId,
        payload: {
          venueIds: preIndexedVenues.venueIds,
          scoresBuffer: preIndexedVenues.scoresBuffer,
          stride: preIndexedVenues.stride ?? 4,
        },
      };
      try {
        workerRef.current.postMessage(message, [preIndexedVenues.scoresBuffer]);
      } catch {
        workerRef.current.postMessage(message);
      }
    } else if (venues && venues.length > 0) {
      indexVenues(venues);
      if (initialWeights) {
        score(initialWeights);
      }
    }
  }, [venues, preIndexedVenues, indexVenues, initialWeights, score]);

  return {
    sortedIds,
    isScoring,
    executionTimeMs,
    error,
    score,
    indexVenues,
    workerAvailable: Boolean(workerRef.current),
  };
}
