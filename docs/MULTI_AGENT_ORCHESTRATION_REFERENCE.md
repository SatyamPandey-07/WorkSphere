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

## 6. Per-Step Tool Latency Metrics

**Source:** [`src/lib/agents/MultiAgentOrchestrator.ts`](../src/lib/agents/MultiAgentOrchestrator.ts)

Each time a subagent runs, the orchestrator loops through up to `maxToolRounds` rounds of LLM calls. Every tool the model asks to run in those rounds is one **step**. For each step whose handler is actually executed, the orchestrator records a latency sample so slow or failing tools can be found without extra instrumentation.

### 6.1 The `ToolMetric` Record

```ts
interface ToolMetric {
  toolName: string;   // Registered tool name
  durationMs: number; // Wall-clock handler time, in milliseconds (>= 0)
  ok: boolean;        // true only if the handler resolved before the timeout
}
```

The samples are returned on `SubagentExecutionResult.toolMetrics`, in execution order. The array is always present and is empty when no tool ran.

### 6.2 What Is (and Is Not) Measured

A sample is recorded **only when a handler is invoked**. The timer starts immediately before `registeredTool.execute(...)` and stops when the handler settles, throws, or times out.

| Situation | Metric recorded? | Counter in `toolExecutionStats` |
| :--- | :---: | :--- |
| Handler resolves | Yes, `ok: true` | `invoked`, `succeeded` |
| Handler throws | Yes, `ok: false` | `invoked`, `failed` |
| Handler exceeds `toolTimeoutMs` | Yes, `ok: false`, `durationMs` is roughly the timeout | `invoked`, `timedOut` |
| Unknown or unapproved tool name | No | `failed` |
| Malformed JSON arguments | No | `failed` |
| Arguments fail schema validation | No | `failed` |
| Duplicate call served from the dedupe cache | No | `deduplicated` |
| Rejected because `maxTotalToolDurationMs` is exhausted | No | `requested`, `failed` |
| Rejected because `maxToolCalls` is exhausted | No | none (not counted as requested) |

Metrics are written in a `finally` block, so a failed or timed-out step is never lost. The recorded duration is `performance.now()` elapsed time; a non-finite value is stored as `0` and negative values are clamped to `0`.

### 6.3 Relationship to Execution Budgets

The same elapsed time feeds the optional **total tool duration budget**:

| Config option | Default | Effect |
| :--- | :---: | :--- |
| `toolTimeoutMs` | `10_000` | Maximum time for a single step before it is recorded as a timeout. |
| `maxToolRounds` | `5` | Maximum LLM-and-tool rounds. |
| `maxToolCalls` | `20` | Maximum tool calls processed across all rounds. |
| `maxTotalToolDurationMs` | unlimited | When the sum of recorded `durationMs` values reaches this limit, remaining tool calls are rejected and the model is no longer offered tools. |

So `sum(toolMetrics[].durationMs)` is exactly the quantity compared against `maxTotalToolDurationMs`.

### 6.4 Example

```ts
const result = await orchestrator.invokeSubagent(task);

for (const metric of result.toolMetrics) {
  console.log(`${metric.toolName}: ${metric.durationMs.toFixed(1)}ms ok=${metric.ok}`);
}

const totalMs = result.toolMetrics.reduce((sum, m) => sum + m.durationMs, 0);
const slowest = [...result.toolMetrics].sort((a, b) => b.durationMs - a.durationMs)[0];
```

### 6.5 Interpreting the Data

- A tool with many `ok: false` samples near `toolTimeoutMs` is timing out; raise the timeout only if the tool is legitimately slow, otherwise fix the tool.
- `toolExecutionStats.requested` greater than `toolMetrics.length` means some requested calls never reached a handler (validation failures, dedupe hits, or exhausted budgets).
- Metrics are per invocation and are not aggregated across subagents. Token-level aggregation lives in `TokenEfficiencyMetrics`.
