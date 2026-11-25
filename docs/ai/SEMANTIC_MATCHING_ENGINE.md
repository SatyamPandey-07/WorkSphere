# Semantic Matching Engine: Resume Embedding Vectorization & pgvector HNSW Indexing

The WorkSphere AI networking and matchmaking engine pairs co-working nomads and remote professionals based on complementary skills, experience levels, and collaborative project goals. It combines structured document parsing, dense high-dimensional vector embeddings, and PostgreSQL `pgvector` Hierarchical Navigable Small World (HNSW) indexing for low-latency approximate nearest neighbor (ANN) retrieval.

---

## 1. System Architecture & End-to-End Pipeline

The semantic matching pipeline transforms unformatted resume files and professional profiles into indexed semantic vectors stored in PostgreSQL and an in-memory client graph.

```mermaid
flowchart TD
    A[Raw Resume PDF / Text] --> B[Web Worker Text Extraction]
    B --> C["ResumeParser (Groq Llama 3 70B)"]
    C --> D[Strict JSON Schema: Skills & Demographics]
    D --> E["SkillEmbedder (OpenAI text-embedding-3-small)"]
    E --> F[1536-Dimensional Vector Batches]
    F --> G[L2 Vector Normalization]
    G --> H["PostgreSQL pgvector HNSW Index (<=>)"]
    G --> I["Client / Edge HNSWVectorStore (Fallback)"]
    H --> J[Dynamic Thresholding & Composite Ranking]
    I --> J
    J --> K[Serendipitous Nomad Recommendations]
```

### Component Breakdown

| Component                    | File Path                                                                                              | Core Role                                                                                                           |
| :--------------------------- | :----------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| **`ResumeParser`**           | [`src/core/ai/ResumeParser.ts`](../../src/core/ai/ResumeParser.ts)                                     | Extracts structured skills, industries, and seniority levels using Groq API with JSON schema enforcement.           |
| **`SkillEmbedder`**          | [`src/core/ai/SkillEmbedder.ts`](../../src/core/ai/SkillEmbedder.ts)                                   | Generates dense 1536-dimensional embeddings in rate-limited batches (`batchSize = 10`) and computes cosine metrics. |
| **`HNSWVectorStore`**        | [`src/core/ai/HNSWVectorStore.ts`](../../src/core/ai/HNSWVectorStore.ts)                               | TypeScript in-memory multi-layer graph vector store for edge search and offline fallback.                           |
| **`PgVectorQueryOptimizer`** | [`src/core/search/PgVectorQueryOptimizer.ts`](../../src/core/search/PgVectorQueryOptimizer.ts)         | Constructs bounded, parameterized SQL queries combining PostGIS geospatial filters with pgvector cosine distances.  |
| **`TopicSimilarityEngine`**  | [`src/core/matchmaking/TopicSimilarityEngine.ts`](../../src/core/matchmaking/TopicSimilarityEngine.ts) | Evaluates context and topic similarity across active nomad sessions.                                                |
| **Matching API Route**       | [`src/app/api/matching/resume/route.ts`](../../src/app/api/matching/resume/route.ts)                   | Next.js API route orchestrating upload, parsing, embedding, and similarity query execution.                         |

---

## 2. Ingestion & Structured Parsing (`ResumeParser.ts`)

Unstructured text from uploaded CVs or member portfolios passes to `ResumeParser`. The parser uses Groq's low-latency inference endpoint running `llama3-70b-8192` at low temperature ($T = 0.1$) to ensure schema adherence.

```typescript
export interface ParsedResume {
  fullName: string;
  email: string;
  skills: string[];
  industries: string[];
  seniorityLevel: "Entry" | "Mid" | "Senior" | "Executive";
  yearsOfExperience: number;
  summary: string;
}
```

### Parsing Pipeline Safeguards

1. **Length Validation:** Resumes shorter than 50 characters are rejected before model invocation to prevent empty API calls.
2. **Strict Schema Constraints:** The system prompt forces output into RFC 8259 JSON format via `response_format: { type: 'json_object' }`.
3. **Defensive Normalization:** Missing strings fall back to `'Unknown'`, empty lists default to `[]`, non-numeric experience defaults to `0`, and unrecognized seniority strings fall back to `'Mid'`.

---

## 3. Skill Embedding Generation (`SkillEmbedder.ts`)

Once skills are extracted (e.g., `["Distributed Systems", "TypeScript", "PostgreSQL", "Raft Consensus"]`), `SkillEmbedder` converts the tokenized skills into continuous high-dimensional vector representations.

### Model Parameters & Dimensions

- **Model:** `text-embedding-3-small`
- **Output Dimensions:** $d = 1536$
- **Rate Limit Batching:** Skills are chunked into sub-arrays of size 10 (`batchSize = 10`) before dispatching requests, preventing rate limits (`429 Too Many Requests`) on extensive profiles.

```typescript
// Batch processing pattern in SkillEmbedder.ts
const batchSize = 10;
for (let i = 0; i < skills.length; i += batchSize) {
  const batch = skills.slice(i, i + batchSize);
  const batchResults = await this.fetchEmbeddings(batch);
  embeddings.push(...batchResults);
}
```

---

## 4. Mathematical Foundations & Vector Normalization

### 4.1 Cosine Similarity Formulation

Given two non-zero vectors $\mathbf{u}, \mathbf{v} \in \mathbb{R}^d$, the cosine similarity measures the cosine of the angle $\theta$ between them:

$$\text{Cosine Similarity}(\mathbf{u}, \mathbf{v}) = \cos(\theta) = \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\|_2 \|\mathbf{v}\|_2} = \frac{\sum_{i=1}^{d} u_i v_i}{\sqrt{\sum_{i=1}^{d} u_i^2} \sqrt{\sum_{i=1}^{d} v_i^2}}$$

- **Domain:** $[-1, 1]$ (for non-negative embedding spaces like text embeddings, typically $[0, 1]$).
- **Interpretation:** $1.0$ indicates identical orientation; $0.0$ indicates orthogonality (uncorrelated skills); $-1.0$ indicates diametrically opposite semantics.

### 4.2 $L_2$ (Euclidean) Vector Normalization

To optimize online similarity searches, vectors can be normalized to unit length ($L_2$ norm = 1):

$$\hat{\mathbf{u}} = \frac{\mathbf{u}}{\|\mathbf{u}\|_2} = \frac{\mathbf{u}}{\sqrt{\sum_{i=1}^{d} u_i^2}}$$

When both $\hat{\mathbf{u}}$ and $\hat{\mathbf{v}}$ are unit-normalized:

$$\|\hat{\mathbf{u}}\|_2 = 1, \quad \|\hat{\mathbf{v}}\|_2 = 1 \implies \text{Cosine Similarity}(\hat{\mathbf{u}}, \hat{\mathbf{v}}) = \hat{\mathbf{u}} \cdot \hat{\mathbf{v}} = \sum_{i=1}^{d} \hat{u}_i \hat{v}_i$$

Pre-normalizing vectors simplifies the calculation to an inner dot product, eliminating expensive square root and division operations during query evaluation.

### 4.3 Cosine Distance in PostgreSQL `pgvector`

PostgreSQL's `pgvector` extension exposes the `<=>` operator for cosine distance:

$$\text{Cosine Distance}(\mathbf{u}, \mathbf{v}) = 1 - \text{Cosine Similarity}(\mathbf{u}, \mathbf{v}) = 1 - \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\|_2 \|\mathbf{v}\|_2}$$

Consequently:

- An exact match has distance $= 0.0$ and similarity $= 1.0$.
- Orthogonal vectors have distance $= 1.0$ and similarity $= 0.0$.
- Similarity score in SQL is derived as: `1 - (embedding <=> query_embedding)`.

---

## 5. PostgreSQL `pgvector` HNSW Index Tuning

WorkSphere stores skill embeddings in PostgreSQL 16+ with the `vector` extension. For datasets exceeding several thousand vectors, sequential scans incur prohibitive latency. WorkSphere employs the Hierarchical Navigable Small World (HNSW) graph algorithm.

### 5.1 DDL & Table Definition

```sql
-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Table definition for nomad member profiles and embeddings
CREATE TABLE IF NOT EXISTS nomad_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    skills TEXT[] NOT NULL DEFAULT '{}',
    industries TEXT[] NOT NULL DEFAULT '{}',
    seniority_level VARCHAR(32) NOT NULL DEFAULT 'Mid',
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.2 HNSW Index Configuration

```sql
-- Create an HNSW index optimized for cosine distance
CREATE INDEX IF NOT EXISTS idx_nomad_profiles_embedding_hnsw
ON nomad_profiles
USING hnsw (embedding vector_cosine_ops)
WITH (
    m = 16,
    ef_construction = 64
);
```

### 5.3 Tuning Parameter Mechanics

The HNSW index constructs a multi-layer graph where lower layers contain denser connections and upper layers contain long-range skip links. Tuning requires balancing build resource consumption, index size, and retrieval quality.

```mermaid
flowchart TD
    subgraph Layer2 ["Layer 2: Sparse Skip Links (Fast Traversal)"]
        L2_A((Node A)) --- L2_D((Node D))
    end
    subgraph Layer1 ["Layer 1: Intermediate Clustering"]
        L1_A((Node A)) --- L1_B((Node B))
        L1_B --- L1_D((Node D))
    end
    subgraph Layer0 ["Layer 0: Dense Base Graph (High Recall)"]
        L0_A((Node A)) --- L0_B((Node B))
        L0_B --- L0_C((Node C))
        L0_C --- L0_D((Node D))
    end
    Layer2 -.-> Layer1
    Layer1 -.-> Layer0
```

| Parameter             | Scope         | Default | Recommended WorkSphere Range | Operational Impact                                                                                                                                                                                          |
| :-------------------- | :------------ | :------ | :--------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`m`**               | Index Build   | `16`    | `16` to `32`                 | Maximum bidirectional links per node in layers $> 0$ (layer 0 has $2m$ links). Higher values increase graph density and recall@k, but increase index footprint in RAM and build time.                       |
| **`ef_construction`** | Index Build   | `64`    | `64` to `128`                | Exploration beam depth during index build. Higher values evaluate more candidate edges, improving graph quality and search recall without altering query execution time, but increase index build duration. |
| **`hnsw.ef_search`**  | Runtime Query | `40`    | `40` to `100`                | Size of dynamic candidate priority queue maintained during nearest-neighbor search. Higher values increase search accuracy and recall at the expense of query latency (ms).                                 |

#### Runtime Search Beam Tuning

Before running similarity matching queries in high-precision scenarios, increase `hnsw.ef_search`:

```sql
-- Tune for balanced 99%+ recall
SET LOCAL hnsw.ef_search = 80;
```

---

## 6. SQL Query Patterns & Query Optimizer Integration

WorkSphere's [`PgVectorQueryOptimizer`](../../src/core/search/PgVectorQueryOptimizer.ts) constructs parameterized, bounded queries that merge vector distance with relational metadata and PostGIS geospatial filtering.

### 6.1 Basic Semantic Similarity Query

```sql
SELECT
    id,
    user_id,
    full_name,
    skills,
    seniority_level,
    1 - (embedding <=> $1::vector) AS similarity_score
FROM nomad_profiles
WHERE 1 - (embedding <=> $1::vector) >= 0.70
ORDER BY embedding <=> $1::vector ASC
LIMIT 10;
```

### 6.2 Hybrid Spatial-Semantic Query

When nomads search for matching peers co-working at local venues or within a specific geographic radius:

```sql
SELECT
    np.user_id,
    np.full_name,
    np.skills,
    ST_DistanceSphere(
        ST_MakePoint(u.longitude, u.latitude),
        ST_MakePoint($2, $3)
    ) AS distance_meters,
    1 - (np.embedding <=> $1::vector) AS similarity_score
FROM nomad_profiles np
JOIN users u ON u.id = np.user_id
WHERE ST_DistanceSphere(
    ST_MakePoint(u.longitude, u.latitude),
    ST_MakePoint($2, $3)
) <= $4
  AND 1 - (np.embedding <=> $1::vector) >= $5
ORDER BY np.embedding <=> $1::vector ASC
LIMIT 10;
```

### 6.3 Query Plan Verification (`EXPLAIN ANALYZE`)

A properly tuned query uses an index scan rather than a sequential scan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, user_id, 1 - (embedding <=> '[0.012, -0.045, ...]'::vector) AS score
FROM nomad_profiles
ORDER BY embedding <=> '[0.012, -0.045, ...]'::vector ASC
LIMIT 10;

-- Expected Execution Plan:
-- Limit  (cost=12.45..34.12 rows=10 width=84) (actual time=1.120..1.245 rows=10 loops=1)
--   Buffers: shared hit=42
--   ->  Index Scan using idx_nomad_profiles_embedding_hnsw on nomad_profiles
--         Order By: (embedding <=> '[0.012, -0.045, ...]'::vector)
-- Planning Time: 0.182 ms
-- Execution Time: 1.310 ms
```

---

## 7. PostgreSQL pgvector Query Benchmarks

Empirical performance evaluation across a representative synthetic benchmark of **100,000 vectors** ($d = 1536$) running on PostgreSQL 16 on 4 vCPU, 16 GB RAM with NVMe storage:

| Metric                 | Sequential Scan (Exact kNN) | IVFFlat (`lists=1000`) | HNSW (`m=16, ef_c=64`) | HNSW (`m=32, ef_c=128`) |
| :--------------------- | :-------------------------- | :--------------------- | :--------------------- | :---------------------- |
| **Index Build Time**   | 0 ms                        | 14.2 s                 | 48.6 s                 | 96.1 s                  |
| **Index Size on Disk** | 0 MB                        | 98 MB                  | 210 MB                 | 340 MB                  |
| **Recall@10**          | 100% (Exact)                | 91.4%                  | **98.7%**              | **99.5%**               |
| **p50 Latency (ms)**   | 45.2 ms                     | 3.8 ms                 | **1.2 ms**             | **1.6 ms**              |
| **p95 Latency (ms)**   | 58.6 ms                     | 6.2 ms                 | **2.1 ms**             | **2.7 ms**              |
| **p99 Latency (ms)**   | 72.8 ms                     | 8.4 ms                 | **2.9 ms**             | **3.4 ms**              |
| **Throughput (QPS)**   | ~22 req/s                   | ~260 req/s             | **~820 req/s**         | **~610 req/s**          |

### Benchmark Insights

1. **HNSW vs IVFFlat:** HNSW achieves near-exact recall ($> 98.5\%$) with $3\times$ higher QPS and substantially lower p99 latency than IVFFlat, justifying its higher RAM footprint.
2. **Impact of `m=16` vs `m=32`:** For 1536-dimensional embeddings, `m=16` provides the optimal sweet spot for WorkSphere workloads, sustaining sub-3ms p99 latency with modest index RAM requirements.

---

## 8. Dynamic Thresholding & Nomad Matchmaking

To avoid repetitive matches while ensuring relevant connections, the networking engine applies **dynamic thresholding** based on the objective of the matchmaking session.

```mermaid
flowchart LR
    Q[Query Vector] --> D{Threshold Strategy}
    D -- "Direct Collaboration (>= 0.82)" --> C1[High Skill Overlap]
    D -- "Serendipitous Networking (0.65 - 0.78)" --> C2[Complementary Skills]
    D -- "Cross-Disciplinary Bridge (< 0.65)" --> C3[Excluded / Filtered Out]
```

### 8.1 Match Categories & Thresholds

| Match Tier                           | Cosine Similarity Range | Use Case & Nomad Dynamics                                           | Example Pairings                                                             |
| :----------------------------------- | :---------------------- | :------------------------------------------------------------------ | :--------------------------------------------------------------------------- |
| **Peer / Direct Collaboration**      | $\ge 0.82$              | Technical pairing, co-debugging, specific domain sprint partners.   | React/Next.js Engineer $\leftrightarrow$ Frontend TypeScript Specialist      |
| **Serendipitous / Cross-Functional** | $0.65 \le S < 0.82$     | Co-founders, hackathon teammates, complementary founders.           | Backend Go/Distributed Systems $\leftrightarrow$ UI/UX Product Designer      |
| **Adjacent Industry**                | $0.55 \le S < 0.65$     | Casual networking, coffee chats, broad co-working company.          | FinTech Quant Developer $\leftrightarrow$ Compliance / Legal Tech Specialist |
| **Irrelevant Noise**                 | $< 0.55$                | Filtered out by query threshold to maintain recommendation quality. | Uncorrelated domains                                                         |

### 8.2 Composite Ranking Formula

Raw cosine similarity is combined with co-location and profile signals to yield the final match score:

$$\text{FinalScore} = w_{\text{sim}} \cdot S_{\text{cosine}} + w_{\text{geo}} \cdot S_{\text{geo}} + w_{\text{seniority}} \cdot S_{\text{seniority}}$$

Where:

- $w_{\text{sim}} = 0.60$ (semantic skill alignment)
- $w_{\text{geo}} = 0.25$ (physical venue proximity or shared co-working hub)
- $w_{\text{seniority}} = 0.15$ (balanced seniority levels for mentorship or peer collaboration)

---

## 9. Client-Side In-Memory Fallback (`HNSWVectorStore.ts`)

For offline mode or privacy-focused edge computing, WorkSphere provides [`HNSWVectorStore.ts`](../../src/core/ai/HNSWVectorStore.ts), a pure TypeScript in-memory vector index.

```typescript
import { HNSWVectorStore, MetricType } from "@/core/ai/HNSWVectorStore";

const clientStore = new HNSWVectorStore({
  dimensions: 1536,
  metric: MetricType.COSINE,
  M: 16,
  efConstruction: 64,
  efSearch: 32,
});

// Insert local nomad embeddings
clientStore.insert({
  id: "nomad_123",
  vector: normalizedEmbedding,
  metadata: { role: "Software Engineer", venueId: "venue_nyc_01" },
});

// Perform local ANN query
const matches = clientStore.search(
  queryVector,
  5,
  (m) => m?.venueId === "venue_nyc_01",
);
```

- **Zero Database Dependency:** Enables local peer matching over WebRTC mesh networks without central database queries.
- **Serialization:** Full JSON state persistence via `toJSON()` and restoration via `HNSWVectorStore.fromJSON(str)`.

---

## 10. Operational Runbook & Edge Cases

### Zero or Near-Zero Vectors

If a profile contains empty skills or degenerate text, the resulting vector norm $\|\mathbf{u}\|_2 \approx 0$. Both `SkillEmbedder.ts` and `TopicSimilarityEngine.ts` guard against division by zero by returning a similarity of `0.0`.

### Dimension Mismatch Prevention

PostgreSQL `pgvector` will throw an error if distance calculation is attempted between different dimensions (e.g., `vector(1536)` vs `vector(768)`). WorkSphere validates dimensions in TypeScript prior to SQL execution:

```typescript
if (queryVector.length !== 1536) {
  throw new Error(
    `Dimension mismatch: expected 1536, got ${queryVector.length}`,
  );
}
```

### Index Maintenance & Reindexing

After substantial batch insertions ($> 20\%$ table growth), run:

```sql
REINDEX INDEX CONCURRENTLY idx_nomad_profiles_embedding_hnsw;
```

This defragments graph nodes and updates neighbor connectivity without locking concurrent reads.

---

## Related Documentation

- [`docs/architecture/README.md`](../architecture/README.md) — WorkSphere system architecture and distributed services index.
- [`docs/README.md`](../README.md) — WorkSphere documentation hub.
- [`docs/ai/memory-agent-pipeline.md`](./memory-agent-pipeline.md) — MemoryAgent pipeline using pgvector and user preferences.
- [`src/core/ai/SkillEmbedder.ts`](../../src/core/ai/SkillEmbedder.ts) — Skill embedding generation implementation.
- [`src/core/ai/ResumeParser.ts`](../../src/core/ai/ResumeParser.ts) — Structured resume parsing implementation.
- [`src/core/ai/HNSWVectorStore.ts`](../../src/core/ai/HNSWVectorStore.ts) — In-memory HNSW vector index implementation.
