/**
 * Hybrid Search Worker Engine and Data Serialization (#5664)
 *
 * Provides shared pure scoring calculations, transferable ArrayBuffer serialization,
 * and typed worker message schemas for hybrid venue search.
 */

export interface HybridScoringWeights {
  semanticWeight?: number; // 0.0 to 1.0
  proximityWeight?: number; // 0.0 to 1.0
  ratingWeight?: number; // 0.0 to 1.0
  fullTextWeight?: number; // 0.0 to 1.0
}

export interface VenueScoringRecord {
  id: string;
  semanticScore?: number;
  proximityScore?: number;
  ratingScore?: number;
  fullTextScore?: number;
  rating?: number;
  distanceKm?: number;
  distance?: number;
  similarity?: number;
  score?: number;
  [key: string]: unknown;
}

export type HybridSearchWorkerRequest =
  | {
      type: "INDEX";
      sequenceId: number;
      payload: {
        venueIds: string[];
        scoresBuffer: ArrayBuffer;
        stride?: number; // default: 4 (semantic, proximity, rating, fullText)
      };
    }
  | {
      type: "SCORE";
      sequenceId: number;
      payload: {
        weights: HybridScoringWeights;
        venueIds?: string[];
        scoresBuffer?: ArrayBuffer;
        stride?: number;
        limit?: number;
      };
    }
  | {
      type: "CLEAR";
      sequenceId?: number;
    };

export type HybridSearchWorkerResponse =
  | {
      type: "INDEX_SUCCESS";
      sequenceId: number;
      count: number;
    }
  | {
      type: "SCORE_SUCCESS";
      sequenceId: number;
      payload: {
        sortedIds: string[];
        sortedIndicesBuffer: ArrayBuffer;
        sortedScoresBuffer: ArrayBuffer;
        count: number;
        executionTimeMs: number;
      };
    }
  | {
      type: "ERROR";
      sequenceId: number;
      error: string;
    };

/**
 * Pure calculation function to compute hybrid scores and sort venue IDs.
 */
export function computeHybridScores(
  venueIds: string[],
  scoresArray: Float32Array,
  weights: HybridScoringWeights,
  stride = 4,
  limit?: number,
): {
  sortedIds: string[];
  sortedIndicesBuffer: ArrayBuffer;
  sortedScoresBuffer: ArrayBuffer;
  count: number;
  executionTimeMs: number;
} {
  const startTime = performance.now();
  const N = venueIds.length;

  if (N === 0 || scoresArray.length === 0) {
    return {
      sortedIds: [],
      sortedIndicesBuffer: new Uint32Array(0).buffer as ArrayBuffer,
      sortedScoresBuffer: new Float32Array(0).buffer as ArrayBuffer,
      count: 0,
      executionTimeMs: performance.now() - startTime,
    };
  }

  const rawSem = Math.max(0, weights.semanticWeight ?? 0);
  const rawProx = Math.max(0, weights.proximityWeight ?? 0);
  const rawRating = Math.max(0, weights.ratingWeight ?? 0);
  const rawText = Math.max(0, weights.fullTextWeight ?? 0);

  const totalWeight = rawSem + rawProx + rawRating + rawText;
  const semW = totalWeight > 0 ? rawSem / totalWeight : 0.25;
  const proxW = totalWeight > 0 ? rawProx / totalWeight : 0.25;
  const ratingW = totalWeight > 0 ? rawRating / totalWeight : 0.25;
  const textW = totalWeight > 0 ? rawText / totalWeight : 0.25;

  const computedScores = new Float32Array(N);
  const indices = new Uint32Array(N);

  for (let i = 0; i < N; i++) {
    indices[i] = i;
    const offset = i * stride;
    const sem = scoresArray[offset] ?? 0;
    const prox = scoresArray[offset + 1] ?? 0;
    const rating = scoresArray[offset + 2] ?? 0;
    const text = stride >= 4 ? (scoresArray[offset + 3] ?? 0) : 0;

    computedScores[i] =
      semW * sem + proxW * prox + ratingW * rating + textW * text;
  }

  // Sort descending by computed score (fallback to index for stability)
  indices.sort((a, b) => {
    const diff = computedScores[b] - computedScores[a];
    if (diff !== 0) return diff;
    return a - b;
  });

  const resultCount = limit !== undefined && limit > 0 ? Math.min(N, limit) : N;

  const sortedIds: string[] = new Array(resultCount);
  const sortedIndices = new Uint32Array(resultCount);
  const sortedScores = new Float32Array(resultCount);

  for (let j = 0; j < resultCount; j++) {
    const origIdx = indices[j];
    sortedIds[j] = venueIds[origIdx];
    sortedIndices[j] = origIdx;
    sortedScores[j] = computedScores[origIdx];
  }

  const executionTimeMs = performance.now() - startTime;

  return {
    sortedIds,
    sortedIndicesBuffer: sortedIndices.buffer as ArrayBuffer,
    sortedScoresBuffer: sortedScores.buffer as ArrayBuffer,
    count: resultCount,
    executionTimeMs,
  };
}

/**
 * Serializes an array of venue records into transferable ArrayBuffers.
 */
export function serializeVenuesToScoresBuffer(
  venues: VenueScoringRecord[],
  stride = 4,
): {
  venueIds: string[];
  scoresBuffer: ArrayBuffer;
  stride: number;
} {
  const N = venues.length;
  const venueIds: string[] = new Array(N);
  const scoresArray = new Float32Array(N * stride);

  for (let i = 0; i < N; i++) {
    const v = venues[i];
    venueIds[i] = String(v.id);

    const sem =
      typeof v.semanticScore === "number"
        ? v.semanticScore
        : typeof v.similarity === "number"
          ? v.similarity
          : 0.5;

    let prox = 0.5;
    if (typeof v.proximityScore === "number") {
      prox = v.proximityScore;
    } else if (typeof v.distanceKm === "number") {
      prox = 1 / (1 + Math.max(0, v.distanceKm) / 5);
    } else if (typeof v.distance === "number") {
      prox = 1 / (1 + Math.max(0, v.distance) / 5);
    }

    let rat = 0.5;
    if (typeof v.ratingScore === "number") {
      rat = v.ratingScore;
    } else if (typeof v.rating === "number") {
      rat = Math.min(1, Math.max(0, v.rating / 5));
    }

    const text =
      typeof v.fullTextScore === "number"
        ? v.fullTextScore
        : typeof v.score === "number"
          ? Math.min(1, Math.max(0, v.score))
          : 0.5;

    scoresArray[i * stride] = sem;
    scoresArray[i * stride + 1] = prox;
    scoresArray[i * stride + 2] = rat;
    if (stride >= 4) {
      scoresArray[i * stride + 3] = text;
    }
  }

  return {
    venueIds,
    scoresBuffer: scoresArray.buffer as ArrayBuffer,
    stride,
  };
}

/**
 * Instantiates the hybridSearch Web Worker safely across browser environments.
 */
export function createDefaultHybridSearchWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  try {
    return new Worker("/workers/hybridSearch.worker.js", { type: "module" });
  } catch {
    return null;
  }
}
