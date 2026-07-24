# WebAssembly SQLite Full-Text Search Engine Integration Specification

## 1. System Overview

WorkSphere incorporates an offline-first, client-side **Full-Text Search (FTS) Engine** powered by **SQLite WebAssembly (WASM)** and the **FTS5** extension module. The engine is isolated within a dedicated **WebWorker** thread, providing sub-5ms BM25-ranked full-text search capability across venue names, tags, and user reviews without blocking the UI rendering thread or relying on network availability.

### Key Features

- **Zero-Latency Offline Search:** Instant query evaluation against locally cached workspace and venue documents.
- **WebWorker Thread Isolation:** Database compilation, indexing, tokenization, and BM25 scoring run off the main DOM thread.
- **BM25 Search Ranking:** Standardized probabilistic relevance scoring ($k1 = 1.2, b = 0.75$) with customizable field weighting multipliers (Name: $3.0\times$, Tags: $2.0\times$, Reviews: $1.0\times$).
- **IndexedDB Persistence & Fallback:** Persistent browser document storage paired with an in-memory fallback BM25 search engine for non-worker environments.

---

## 2. Architecture & WebWorker Thread Isolation

To guarantee $60\text{ fps}$ application performance during heavy search indexing or query parsing, database interactions are strictly encapsulated within a dedicated worker context (`src/workers/sqlite-search.worker.ts`).

```
+-----------------------------------------------------------------------------------+
|                                  MAIN DOM THREAD                                  |
|                                                                                   |
|  [Search Input] ---> SQLiteFTS5SearchEngine.search("quiet workspace")            |
|                                  |                                                |
|                                  | postMessage({ type: "SEARCH", id, query })      |
|                                  v                                                |
+----------------------------------|------------------------------------------------+
                                   | (Worker Channel)
                                   v
+-----------------------------------------------------------------------------------+
|                                 WEBWORKER THREAD                                  |
|                       (src/workers/sqlite-search.worker.ts)                        |
|                                                                                   |
|  1. Parse query tokens ("quiet", "workspace")                                     |
|  2. Execute SQLite WASM FTS5 Virtual Table query                                  |
|  3. Calculate BM25 score & identify matched fields (name, tags, reviews)          |
|  4. Sort results descending by score                                              |
|                                  |                                                |
|                                  | postMessage({ type: "SEARCH_RESULTS", ... })    |
+----------------------------------|------------------------------------------------+
                                   v
+-----------------------------------------------------------------------------------+
|  [Search Component] <--- Promise resolves with SearchResultItem[]                  |
+-----------------------------------------------------------------------------------+
```

---

## 3. SQLite WASM Schema & FTS5 Query Syntax

The FTS engine creates an in-memory SQLite virtual table configured with the FTS5 extension.

### 3.1 SQL Schema Definition

```sql
-- Virtual Table Creation for Venue Full-Text Indexing
CREATE VIRTUAL TABLE IF NOT EXISTS venue_fts USING fts5(
  id UNINDEXED,        -- Unique venue record identifier (not tokenized)
  name,                -- Venue primary title / name (Weight: 3.0)
  tags,                -- Array of tags joined by space (Weight: 2.0)
  reviews,             -- User reviews aggregated text (Weight: 1.0)
  tokenize = 'unicode61 remove_diacritics 2' -- Standardized Unicode tokenizer
);
```

### 3.2 FTS5 Query Syntax Examples

The FTS5 module supports rich search syntax patterns:

| Query Type               | Input Query Pattern | Transformed FTS5 Expression         | Description                                                          |
| :----------------------- | :------------------ | :---------------------------------- | :------------------------------------------------------------------- |
| **Simple Term**          | `espresso`          | `venue_fts MATCH 'espresso'`        | Matches documents containing the term `espresso`.                    |
| **Multi-Term Phrase**    | `"quiet cafe"`      | `venue_fts MATCH '"quiet cafe"'`    | Matches exact token sequence `"quiet cafe"`.                         |
| **Prefix Matching**      | `work*`             | `venue_fts MATCH 'work*'`           | Matches terms starting with `work` (e.g., `workspace`, `workplace`). |
| **Boolean Combination**  | `wifi AND silent`   | `venue_fts MATCH 'wifi AND silent'` | Documents must contain both `wifi` and `silent`.                     |
| **Field-Specific Match** | `name:starbucks`    | `venue_fts MATCH 'name:starbucks'`  | Restricts term matching strictly to the `name` column.               |

---

## 4. BM25 Search Ranking & Scoring Algorithm

Search relevance is computed using Okapi **BM25**, tuned with term frequency field weights.

### 4.1 BM25 Formula Implementation

$$\text{Score}(D, Q) = \sum_{i=1}^{n} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$

where IDF (Inverse Document Frequency) is defined as:

$$\text{IDF}(q_i) = \ln \left( \frac{N - n(q_i) + 0.5}{n(q_i) + 0.5} + 1 \right)$$

### 4.2 Weighted Term Frequency Calculation (`src/lib/wasm/sqliteSearch.ts`)

```typescript
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

    // Field-weighted term frequencies (Name=3.0, Tags=2.0, Reviews=1.0)
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
```

---

## 5. WebWorker Protocol Schema

Communication between the main application thread (`SQLiteFTS5SearchEngine`) and the search worker (`sqlite-search.worker.ts`) adheres to typed message interfaces.

### 5.1 Request Messages (Main Thread $\rightarrow$ Worker)

```typescript
export interface SQLiteSearchWorkerMessage {
  type: "INIT" | "INDEX" | "SEARCH";
  id?: string;
  documents?: VenueSearchDocument[];
  query?: string;
}

export interface VenueSearchDocument {
  id: string;
  name: string;
  tags?: string[];
  reviews?: string[];
}
```

### 5.2 Response Messages (Worker $\rightarrow$ Main Thread)

```typescript
export interface SQLiteSearchWorkerResponse {
  type: "INIT_SUCCESS" | "INDEX_SUCCESS" | "SEARCH_RESULTS" | "ERROR";
  id?: string;
  results?: SearchResultItem[];
  executionTimeMs?: number;
  count?: number;
  error?: string;
}

export interface SearchResultItem {
  id: string;
  name: string;
  score: number;
  matchedFields: string[];
  executionTimeMs: number;
}
```

---

## 6. IndexedDB Persistence & Fallback Strategy

1. **Warm Start from IndexedDB:** Upon application initialization, document payloads stored in local `IndexedDB` (`offlineStore.ts`) are fetched and transmitted via an `INDEX` message to populate the worker search memory.
2. **Main Thread Fallback Engine:** If WebWorker instantiation fails (e.g., restricted browser sandbox or CSP policy), `SQLiteFTS5SearchEngine` seamlessly falls back to synchronous in-memory BM25 evaluation without throwing runtime exceptions.

---

## 7. Verification & Benchmarking Commands

To execute test suites validating the WASM SQLite search engine, worker initialization, and BM25 scoring algorithm:

```bash
# Run WASM SQLite FTS5 engine unit tests
npx jest src/__tests__/lib/wasm/sqliteSearch.test.ts
```
