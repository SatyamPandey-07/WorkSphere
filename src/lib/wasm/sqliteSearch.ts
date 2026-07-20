/**
 * Client-Side Offline Full-Text Search Engine using WebAssembly SQLite & FTS5 (#906)
 *
 * Provides sub-5ms BM25 ranking full-text search across venue names, tags, and reviews
 * running inside a WebWorker memory space.
 */

export interface VenueSearchDocument {
  id: string;
  name: string;
  tags?: string[];
  reviews?: string[];
}

export interface SearchResultItem {
  id: string;
  name: string;
  score: number;
  matchedFields: string[];
  executionTimeMs: number;
}

export interface SQLiteSearchWorkerMessage {
  type: "INIT" | "INDEX" | "SEARCH";
  id?: string;
  documents?: VenueSearchDocument[];
  query?: string;
}

export interface SQLiteSearchWorkerResponse {
  type: "INIT_SUCCESS" | "INDEX_SUCCESS" | "SEARCH_RESULTS" | "ERROR";
  id?: string;
  results?: SearchResultItem[];
  executionTimeMs?: number;
  count?: number;
  error?: string;
}

/**
 * Calculates BM25 score for a document relative to query tokens
 */
export function calculateBM25Score(
  doc: { name: string; tags: string[]; reviews: string[] },
  queryTokens: string[],
  totalDocs: number,
  avgDocLen: number,
  docFreqs: Record<string, number>,
  k1 = 1.2,
  b = 0.75,
): { score: number; matchedFields: string[] } {
  const nameText = doc.name.toLowerCase();
  const tagsText = doc.tags.join(" ").toLowerCase();
  const reviewsText = doc.reviews.join(" ").toLowerCase();
  const fullText = `${nameText} ${tagsText} ${reviewsText}`;

  const docTokens = fullText.split(/\s+/).filter(Boolean);
  const docLen = docTokens.length;

  let totalScore = 0;
  const matchedFields = new Set<string>();

  for (const token of queryTokens) {
    const term = token.toLowerCase();
    if (!term) continue;

    // Count term frequencies per field (with field weights: name=3.0, tags=2.0, reviews=1.0)
    const nameTF = (nameText.match(new RegExp(`\\b${term}`, "g")) || []).length;
    const tagsTF = (tagsText.match(new RegExp(`\\b${term}`, "g")) || []).length;
    const reviewsTF = (reviewsText.match(new RegExp(`\\b${term}`, "g")) || [])
      .length;

    if (nameTF > 0) matchedFields.add("name");
    if (tagsTF > 0) matchedFields.add("tags");
    if (reviewsTF > 0) matchedFields.add("reviews");

    const weightedTF = nameTF * 3.0 + tagsTF * 2.0 + reviewsTF * 1.0;

    if (weightedTF > 0) {
      const df = docFreqs[term] || 1;
      const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
      const tfNorm =
        (weightedTF * (k1 + 1)) /
        (weightedTF + k1 * (1 - b + b * (docLen / (avgDocLen || 1))));
      totalScore += idf * tfNorm;
    }
  }

  return { score: totalScore, matchedFields: Array.from(matchedFields) };
}

export class SQLiteFTS5SearchEngine {
  private worker: Worker | null = null;
  private isInitialized = false;
  private documents: Map<string, VenueSearchDocument> = new Map();
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();
  private messageCounter = 0;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    if (typeof window !== "undefined" && typeof Worker !== "undefined") {
      try {
        this.worker = new Worker(
          new URL("../../workers/sqlite-search.worker.ts", import.meta.url),
        );
        this.worker.onmessage = (
          e: MessageEvent<SQLiteSearchWorkerResponse>,
        ) => {
          const { id, type, results, count, executionTimeMs, error } = e.data;
          if (id && this.pendingRequests.has(id)) {
            const { resolve, reject } = this.pendingRequests.get(id)!;
            this.pendingRequests.delete(id);

            if (type === "ERROR") {
              reject(new Error(error || "Worker error"));
            } else if (type === "SEARCH_RESULTS") {
              resolve({
                results: results || [],
                executionTimeMs: executionTimeMs || 0,
              });
            } else if (type === "INDEX_SUCCESS") {
              resolve({ count: count || 0 });
            } else if (type === "INIT_SUCCESS") {
              resolve(true);
            }
          }
        };
      } catch (err) {
        console.warn(
          "[SQLite FTS5] Worker initialization fallback to main-thread engine",
          err,
        );
      }
    }
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    if (this.worker) {
      const id = `init_${++this.messageCounter}`;
      const promise = new Promise<void>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
      });
      this.worker.postMessage({ type: "INIT", id });
      await promise;
    }

    this.isInitialized = true;
  }

  public async indexVenues(venues: VenueSearchDocument[]): Promise<number> {
    await this.init();

    // Store in internal document map
    for (const v of venues) {
      this.documents.set(v.id, v);
    }

    if (this.worker) {
      const id = `index_${++this.messageCounter}`;
      const promise = new Promise<{ count: number }>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
      });
      this.worker.postMessage({ type: "INDEX", id, documents: venues });
      const res = await promise;
      return res.count;
    }

    return venues.length;
  }

  public async search(
    query: string,
    limit = 20,
  ): Promise<{ results: SearchResultItem[]; executionTimeMs: number }> {
    const startTime = performance.now();
    await this.init();

    const trimmed = query.trim();
    if (!trimmed) {
      return { results: [], executionTimeMs: performance.now() - startTime };
    }

    if (this.worker) {
      const id = `search_${++this.messageCounter}`;
      const promise = new Promise<{
        results: SearchResultItem[];
        executionTimeMs: number;
      }>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
      });
      this.worker.postMessage({ type: "SEARCH", id, query: trimmed });
      return promise;
    }

    // Direct in-memory fallback BM25 search
    const queryTokens = trimmed.split(/\s+/).filter(Boolean);
    const docs = Array.from(this.documents.values());
    const totalDocs = docs.length;

    let totalLen = 0;
    const docFreqs: Record<string, number> = {};

    docs.forEach((doc) => {
      const fullText =
        `${doc.name} ${(doc.tags || []).join(" ")} ${(doc.reviews || []).join(" ")}`.toLowerCase();
      const tokens = fullText.split(/\s+/).filter(Boolean);
      totalLen += tokens.length;

      const uniqueTokens = new Set(tokens);
      uniqueTokens.forEach((t) => {
        docFreqs[t] = (docFreqs[t] || 0) + 1;
      });
    });

    const avgDocLen = totalDocs > 0 ? totalLen / totalDocs : 1;
    const scoredResults: SearchResultItem[] = [];

    docs.forEach((doc) => {
      const { score, matchedFields } = calculateBM25Score(
        {
          name: doc.name,
          tags: doc.tags || [],
          reviews: doc.reviews || [],
        },
        queryTokens,
        totalDocs,
        avgDocLen,
        docFreqs,
      );

      if (score > 0) {
        scoredResults.push({
          id: doc.id,
          name: doc.name,
          score,
          matchedFields,
          executionTimeMs: 0,
        });
      }
    });

    scoredResults.sort((a, b) => b.score - a.score);
    const limited = scoredResults.slice(0, limit);
    const executionTimeMs = performance.now() - startTime;

    const finalResults = limited.map((r) => ({
      ...r,
      executionTimeMs,
    }));

    return { results: finalResults, executionTimeMs };
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.documents.clear();
    this.isInitialized = false;
  }
}

let searchEngineInstance: SQLiteFTS5SearchEngine | null = null;

export function getSQLiteFTS5Engine(): SQLiteFTS5SearchEngine {
  if (!searchEngineInstance) {
    searchEngineInstance = new SQLiteFTS5SearchEngine();
  }
  return searchEngineInstance;
}
