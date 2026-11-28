# Multi-Agent LLM Orchestration & Context Vector Store Reference

## 1. Overview & System Architecture

WorkSphere leverages an asynchronous, DAG-directed (Directed Acyclic Graph) **Multi-Agent AI Orchestration Framework** designed for context-aware automation, real-time tool execution, and token-optimized semantic retrieval.
+------------------+
|   User Request   |
+------------------+
|
v
+------------------+     Context Retrieval      +---------------------------+
|    Orchestrator  | -------------------------> |  HNSW Vector Store        |
|    Router Agent  | <------------------------- | (pgvector / Local Memory) |
+------------------+   Relevant Embeddings      +---------------------------+
|
| (Intent Graph Routing)
+-------------------+-------------------+
|                   |                   |
v                   v                   v
+-----------------+ +-----------------+ +-----------------+
|  Planner Agent  | | Execution Agent | | Validation Agent|
+-----------------+ +-----------------+ +-----------------+
|                   |                   |
+-------------------+-------------------+
|
v
+--------------------+
|  Final Aggregator  |
+--------------------+


### Core Capabilities
* **Low-Latency Inference:** Uses Groq LPU (Language Processing Unit) hardware acceleration via the Groq SDK for near-instant router classification.
* **Hierarchical Memory:** Hierarchical Navigable Small World (HNSW) graph indexing enables fast $O(\log N)$ approximate nearest-neighbor vector retrieval for workspace context.
* **Token Efficiency:** Context window budget management prevents prompt bloat through automatic text truncation, sliding-window summaries, and dynamic vector similarity filtering.

---

## 2. Groq SDK Integration & Agent Execution Graph

The orchestration core uses an event-driven execution graph where a lightweight router evaluates incoming user prompts and delegates tasks to specialized worker agents.

### 2.1 Groq Client Configuration
```typescript
import Groq from '@groq/sdk';

export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const MODEL_CONFIGS = {
  router: 'llama-3.3-70b-versatile',
  worker: 'llama-3.3-70b-versatile',
  fastExecutor: 'llama-3.1-8b-instant',
};
```
## 2.2 Agent Execution Flow
*Classification (Router):* Evaluates user intent and generates an execution plan with specific sub-agent targets.

*Context Enrichment:* Queries the HNSW Vector Store with prompt embeddings to retrieve relevant conversation and document context.

*Parallel Task Execution:* Dispatches independent steps concurrently across domain agents (e.g., Code Execution, Summarization, Retrieval).

*Validation & Synthesis:* A reviewer node verifies outputs against constraints before returning the payload to the user.

3. System Prompt Templates
To maintain execution predictability and structured outputs across agents, WorkSphere enforces strict system prompts with JSON schema validation.

## 3.1 Router System Prompt

*SYSTEM:* You are the WorkSphere Master Orchestrator Router.
Your task is to analyze user queries, classify intent, and route tasks to specialized sub-agents.

*AVAILABLE AGENTS:*
- PlannerAgent: Breaks down complex multistep workspace goals.
- DocumentAgent: Handles context synthesis, summarization, and note retrieval.
- SystemAgent: Manages workspace settings, API configurations, and local DB operations.

*OUTPUT FORMAT:*
Respond strictly in valid JSON matching this schema:
```
{
  "intent": string,
  "confidence": number,
  "next_agent": "PlannerAgent" | "DocumentAgent" | "SystemAgent" | "DirectResponse",
  "subtasks": Array<{ "id": string, "description": string, "agent": string }>
}
```
## 3.2 Context Synthesis Agent Prompt

*SYSTEM:* You are a Zero-Knowledge Context Synthesis Agent.
You answer user questions using ONLY the retrieved context provided in <context></context> tags.

*RULES:*
1. If the provided context is insufficient, explicitly state "Insufficient context available."
2. Do not hallucinate or extrapolate outside the provided snippets.
3. Keep responses concise, objective, and clear.
4. HNSW Context Vector Store Reference
WorkSphere maintains high-dimensional embeddings in an HNSW-indexed vector store for fast semantically matched memory retrieval.
### 4.1 Index & Embedding Parameters

| Parameter | Value | Description |
| :--- | :---: | :--- |
| **Embedding Model** | `text-embedding-3-small` | Standard dense vector generator |
| **Embedding Dimensions** | `1,536` | Dimensionality for semantic representation |
| **Distance Metric** | `Cosine` | Normalized distance evaluation for similarity scores |
| **HNSW M Parameter** | `16` | Max bidirectional links created per graph node |
| **HNSW ef_construction** | `64` | Search depth setting during index construction |
| **HNSW ef_search** | `32` | Runtime query depth trade-off (accuracy vs speed) |

## 4.2 Query Execution Pattern
```
interface VectorQueryResult {
  id: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
}

async function queryContextStore(
  queryEmbedding: number[],
  topK: number = 5,
  similarityThreshold: number = 0.78
): Promise<VectorQueryResult[]> {
  // Query HNSW Index (Cosine similarity)
  const results = await vectorStore.query({
    vector: queryEmbedding,
    topK: topK,
    includeMetadata: true,
  });

  // Filter out low-confidence context matches to protect token window
  return results.filter((item) => item.score >= similarityThreshold);
}
```
## 5. Token Optimization & Context Budgeting

| Strategy | Target Layer | Implementation Detail |
| :--- | :---: | :--- |
| **Dynamic Top-K Thresholding** | Vector Store | Hard similarity cutoff (`>= 0.78`) prevents injecting low-relevance chunks into the system prompt. |
| **Model Tiering** | Agent Routing | Direct basic tasks to `llama-3.1-8b-instant` and reserve heavy reasoning for `llama-3.3-70b-versatile`. |
| **Context Compression** | Memory System | Conversation turns exceeding 8,000 tokens are automatically summarized into persistent state vectors. |
| **Strict JSON Output Framing** | Groq Inference | Forces short, unpadded JSON outputs to eliminate conversational filler tokens during routing decisions. |

## 6. Bounded Tool Loops: Per-Step Latency Metrics

`SubagentExecutionResult.toolMetrics` is an ordered array of `ToolMetric` records.
The bounded tool-call loop appends one record for each registered tool handler
that is actually invoked. Each record describes one invocation, not an entire
LLM round or the full subagent execution.

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `toolName` | `string` | Name of the registered tool handler that was invoked. |
| `durationMs` | `number` | Elapsed time from immediately before the handler/timeout race starts until it settles. **All latency duration values are in milliseconds (`ms`).** The value is the measured elapsed duration, can include fractional milliseconds, and is clamped to zero if negative or non-finite. |
| `ok` | `boolean` | `true` when the handler resolves successfully before the timeout; `false` when it throws or the timeout race rejects. |

The timer is started immediately before `registeredTool.execute` is raced
against the configured `toolTimeoutMs`. The metric is appended in the `finally`
path, so an invoked handler has a duration record whether it succeeds, throws,
or times out. For a timeout, `durationMs` measures time until the timeout
rejection is observed; it is not the eventual completion time of the handler
(the timeout race does not cancel the underlying handler).

`ToolMetric` has no dedicated error message, call ID, round number, or timeout
flag. A timeout is represented by `ok: false`; its count is exposed separately
as `toolExecutionStats.timedOut`. The tool result returned to the loop also
contains an `error` message such as `Tool 'slow_lookup' timed out after 10000ms`.
The implementation classifies a caught error as a timeout when its message
contains `timed out`. Such calls increment `timedOut`, not `failed`; other
handler errors increment `failed`. Successful calls increment `succeeded` and
their names are added to `toolsInvoked`.

The loop is bounded by `maxToolRounds` (default `5`), `maxToolCalls` (default
`20`), `toolTimeoutMs` (default `10000` ms), and
`maxTotalToolDurationMs` (default `Infinity` ms). `toolMetrics` accumulates
across the rounds in invocation order. Time spent generating LLM completions,
validating arguments, rejecting unapproved tools, or serving deduplicated calls
is not recorded as a per-step latency metric because those paths do not invoke
the tool handler. Calls rejected after the total tool-duration budget is
exhausted also do not create a `ToolMetric`. Each recorded `durationMs`
contributes to the loop's total tool-duration budget; that total is not itself
included in `toolMetrics`.

Example result excerpt:

```json
{
  "toolsInvoked": ["venue_search"],
  "toolExecutionStats": {
    "requested": 3,
    "validated": 3,
    "invoked": 3,
    "succeeded": 1,
    "failed": 1,
    "timedOut": 1,
    "deduplicated": 0
  },
  "toolMetrics": [
    {
      "toolName": "venue_search",
      "durationMs": 34.68,
      "ok": true
    },
    {
      "toolName": "venue_details",
      "durationMs": 12.41,
      "ok": false
    },
    {
      "toolName": "slow_lookup",
      "durationMs": 10004.73,
      "ok": false
    }
  ]
}
```

In this example, the last entry's elapsed duration is slightly above the
10,000 ms timeout because it records observed elapsed time rather than copying
the configured timeout value. The aggregate `timedOut` count distinguishes it
from the ordinary failed invocation; it is not an extra per-step metric field.