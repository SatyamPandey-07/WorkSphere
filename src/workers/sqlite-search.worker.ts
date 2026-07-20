import {
  VenueSearchDocument,
  SearchResultItem,
  SQLiteSearchWorkerMessage,
  SQLiteSearchWorkerResponse,
  calculateBM25Score,
} from "../lib/wasm/sqliteSearch";

// SQLite WASM / FTS5 memory store
const indexedDocuments: Map<string, VenueSearchDocument> = new Map();
let _isInitialized = false;

function postMessageToMain(msg: SQLiteSearchWorkerResponse) {
  self.postMessage(msg);
}

self.addEventListener(
  "message",
  (e: MessageEvent<SQLiteSearchWorkerMessage>) => {
    const { type, id, documents, query } = e.data;

    switch (type) {
      case "INIT": {
        // Simulate WASM SQLite FTS5 table initialization:
        // CREATE VIRTUAL TABLE venue_fts USING fts5(id UNINDEXED, name, tags, reviews);
        _isInitialized = true;
        postMessageToMain({ type: "INIT_SUCCESS", id });
        break;
      }

      case "INDEX": {
        if (!documents) {
          postMessageToMain({
            type: "ERROR",
            id,
            error: "No documents provided for indexing",
          });
          return;
        }

        for (const doc of documents) {
          indexedDocuments.set(doc.id, doc);
        }

        postMessageToMain({
          type: "INDEX_SUCCESS",
          id,
          count: indexedDocuments.size,
        });
        break;
      }

      case "SEARCH": {
        const startTime = performance.now();
        if (!query || !query.trim()) {
          postMessageToMain({
            type: "SEARCH_RESULTS",
            id,
            results: [],
            executionTimeMs: 0,
          });
          return;
        }

        const queryTokens = query.trim().split(/\s+/).filter(Boolean);
        const docs = Array.from(indexedDocuments.values());
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
        const executionTimeMs = performance.now() - startTime;

        const finalResults = scoredResults.map((r) => ({
          ...r,
          executionTimeMs,
        }));

        postMessageToMain({
          type: "SEARCH_RESULTS",
          id,
          results: finalResults,
          executionTimeMs,
        });
        break;
      }
    }
  },
);
