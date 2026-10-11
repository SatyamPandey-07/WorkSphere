# Semantic Search API Reference

Comprehensive technical API documentation for WorkSphere's Semantic Search service ([`/api/search/semantic`](file:///c:/Users/admin/Desktop/workfere/src/app/api/search/semantic/route.ts)). This endpoint orchestrates Unicode text segmentation, high-dimensional vector embedding generation, and cosine similarity scoring over PostgreSQL `pgvector` HNSW indexes.

---

## 1. Endpoint Overview

- **HTTP Method:** `POST`
- **Route:** `/api/search/semantic`
- **Authentication:** Public or Authenticated (Bearer Token optional for personalized ranking)
- **Headers:**
  - `Content-Type: application/json`
- **Engine Stack:**
  - **Tokenizer:** WebAssembly Unicode UAX #29 Segmentation ([`unicodeTokenizer.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/wasm-loader/tokenizer.ts))
  - **Embedding Generator:** Groq API / LLM Embeddings ([`SemanticEmbeddingGenerator.ts`](file:///c:/Users/admin/Desktop/workfere/src/core/search/SemanticEmbeddingGenerator.ts))
  - **Vector Query Optimizer:** `pgvector` HNSW index builder ([`PgVectorQueryOptimizer.ts`](file:///c:/Users/admin/Desktop/workfere/src/core/search/PgVectorQueryOptimizer.ts))

---

## 2. Request Schema

### 2.1 Request Headers

| Header | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `Content-Type` | `string` | **Yes** | Must be `application/json`. |
| `Authorization` | `string` | No | `Bearer <token>` for user preference personalization. |

### 2.2 JSON Body Parameters

```json
{
  "query": "quiet coworking space with dual monitors and high-speed fiber wifi",
  "filters": {
    "minRating": 4.5,
    "amenities": ["Dual Monitors", "Fiber WiFi", "Phone Booth"],
    "maxDistanceMeters": 5000,
    "userLat": 37.7749,
    "userLng": -122.4194,
    "isOpenNow": true
  },
  "similarityThreshold": 0.65,
  "limit": 10
}
```

### 2.3 Parameter Specifications

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :---: | :---: | :--- |
| `query` | `string` | **Yes** | — | Natural language search prompt. Minimum length 1 character. |
| `filters` | `object` | No | `{}` | Structured metadata filters applied alongside vector search. |
| `filters.minRating` | `number` | No | `0.0` | Minimum venue rating threshold (range: `0.0` to `5.0`). |
| `filters.amenities` | `string[]` | No | `[]` | Array of amenity tags that must all be present (`@>` containment). |
| `filters.maxDistanceMeters` | `number` | No | — | Maximum radius in meters from user coordinates (`ST_DistanceSphere`). |
| `filters.userLat` | `number` | No | — | User latitude in WGS 84 (range: `-90.0` to `90.0`). |
| `filters.userLng` | `number` | No | — | User longitude in WGS 84 (range: `-180.0` to `180.0`). |
| `filters.isOpenNow` | `boolean` | No | `false` | When `true`, restricts search to currently operating workspaces. |
| `similarityThreshold` | `number` | No | `0.5` | Minimum cosine similarity cutoff score (range: `0.0` to `1.0`). |
| `limit` | `integer` | No | `10` | Maximum number of results to return (range: `1` to `50`). |

---

## 3. Embedding Model & Vector Dimensions

The semantic search pipeline supports high-dimensional vector representations configured in [`SemanticEmbeddingGenerator.ts`](file:///c:/Users/admin/Desktop/workfere/src/core/search/SemanticEmbeddingGenerator.ts):

| Model Name | Provider | Dimensionality ($d$) | Metric | Primary Use Case |
| :--- | :--- | :---: | :---: | :--- |
| **`llama3-8b-8192` (Default)** | Groq / Meta | **384** / **1024** | Cosine (`<=>`) | Fast multi-lingual semantic matching |
| **`embed-english-v3.0`** | Cohere | **1024** | Cosine (`<=>`) | English semantic search with high topical accuracy |
| **`text-embedding-3-small`** | OpenAI | **1536** | Cosine (`<=>`) | General-purpose workspace similarity |

### Cosine Distance vs. Similarity Score

In `pgvector`, the `<=>` operator computes cosine distance:

$$\text{Distance} = 1 - \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\|_2 \|\mathbf{v}\|_2}$$

The API converts this into a normalized **Similarity Score**:

$$\text{similarity\_score} = 1 - (\text{embedding} \Leftrightarrow \text{query\_vector})$$

---

## 4. Cosine Similarity Thresholds & Matching Tiers

The `similarityThreshold` parameter filters low-confidence vector noise:

```
[0.00 ─────── Low (Noise) ─────── 0.50 ──── Moderate ──── 0.70 ── High ── 0.85 ── Exact/Near-Synonym ── 1.00]
```

| Threshold Range | Match Quality | Interpretation & User Experience |
| :---: | :---: | :--- |
| **$\ge 0.85$** | **Exact / Near-Synonym** | Highly targeted match. Direct match for specific amenities, brands, or workspace names. |
| **$0.70\text{--}0.84$** | **Strong Semantic Match** | Matches query intent (e.g., query `"place to take quiet client video calls"` matches `"acoustic private phone booth with ring light"`). |
| **$0.50\text{--}0.69$** | **Moderate / Broad Match** | General contextual relevance (e.g., query `"chill cafe"` matches `"rooftop lounge with pour-over coffee"`). |
| **$< 0.50$** | **Weak / Noise** | Discarded by default to prevent irrelevant recommendations. |

---

## 5. Sample Response Payloads

### 5.1 Success Response (`200 OK`)

```json
{
  "success": true,
  "tokenizedQuery": "quiet coworking space with dual monitors and high-speed fiber wifi",
  "queryVectorLength": 384,
  "generatedSql": "SELECT id, name, description, rating, latitude, longitude, 1 - (embedding <=> $1::vector) AS similarity_score FROM venues WHERE 1=1 AND rating >= $2 AND amenities @> $3::text[] AND ST_DistanceSphere(ST_MakePoint(longitude, latitude), ST_MakePoint($4, $5)) <= $6 AND is_currently_open = true ORDER BY embedding <=> $1::vector ASC LIMIT $7",
  "similarityThreshold": 0.65,
  "totalMatches": 2,
  "data": [
    {
      "id": "v-sf-soma-01",
      "name": "Workshop Cafe & Quiet Pods",
      "description": "Soundproof acoustic phone booths, dual 4K monitors, and dedicated 500 Mbps fiber connectivity.",
      "rating": 4.8,
      "latitude": 37.7785,
      "longitude": -122.4056,
      "distanceMeters": 1420,
      "isCurrentlyOpen": true,
      "amenities": ["Dual Monitors", "Fiber WiFi", "Phone Booth", "Ergonomic Chairs"],
      "similarityScore": 0.892
    },
    {
      "id": "v-sf-fidi-04",
      "name": "Canopy Collaborative Lounge",
      "description": "High-speed workspace with executive hot desks, ultra-wide screens, and private meeting nooks.",
      "rating": 4.6,
      "latitude": 37.7912,
      "longitude": -122.4011,
      "distanceMeters": 2350,
      "isCurrentlyOpen": true,
      "amenities": ["Dual Monitors", "Fiber WiFi", "Phone Booth"],
      "similarityScore": 0.741
    }
  ],
  "message": "Semantic search pipeline executed successfully"
}
```

### 5.2 Invalid Query String (`400 Bad Request`)

```json
{
  "error": "Valid query string is required",
  "statusCode": 400
}
```

### 5.3 Missing API Key Configuration (`500 Internal Server Error`)

```json
{
  "error": "Embedding API key not configured",
  "statusCode": 500
}
```

---

## 6. Client Integration Examples

### 6.1 cURL

```bash
curl -X POST https://worksphere.app/api/search/semantic \
  -H "Content-Type: application/json" \
  -d '{
    "query": "standing desk near coffee shop with gigabit internet",
    "filters": {
      "minRating": 4.0,
      "amenities": ["Standing Desks", "Coffee Bar"],
      "isOpenNow": true
    },
    "similarityThreshold": 0.6,
    "limit": 5
  }'
```

### 6.2 TypeScript / Fetch

```typescript
interface SemanticSearchResponse {
  success: boolean;
  tokenizedQuery: string;
  queryVectorLength: number;
  totalMatches: number;
  data: Array<{
    id: string;
    name: string;
    description: string;
    rating: number;
    latitude: number;
    longitude: number;
    similarityScore: number;
  }>;
}

export async function searchWorkspaces(query: string): Promise<SemanticSearchResponse> {
  const response = await fetch('/api/search/semantic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      filters: {
        minRating: 4.2,
        isOpenNow: true,
      },
      similarityThreshold: 0.65,
      limit: 10,
    }),
  });

  if (!response.ok) {
    throw new Error(`Search failed with status: ${response.status}`);
  }

  return response.json();
}
```
