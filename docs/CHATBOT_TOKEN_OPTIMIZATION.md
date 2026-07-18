# Multi-Agent Chatbot Token Optimization Directives

This document outlines the strict directives for managing and optimizing token consumption when interacting with the Groq LLM API in the WorkSphere multi-agent chatbot system.

---

## 1. Prompt Context Reduction Rules

Sending the entire conversation history to the LLM for every request leads to massive token waste and API rate limits. Implement the following rules for context reduction:

- **Token-Budget Based Pruning:** Do not rely solely on turn counts (e.g., the last 5 messages). Instead, define a strict input-token budget—including the system prompt, tools, summary, and current request—and prune the older history until it fits.
- **Dynamic Summarization:** Once the context approaches the token budget, trigger a background agent to generate a concise summary of the older context. Keep this dynamic summary separate from the static system prompt prefix to ensure Groq's automatic prefix caching functions correctly.
- **State-Based Pruning:** Remove system acknowledgments, filler words, or UI-specific JSON responses from the context array before sending it back to the API.

---

## 2. Message Length Constraints

To prevent malicious token draining and maintain fast inference speeds on Groq, enforce the following constraints at the application level:

- **User Input Limit:** Enforce token-aware input limits strictly on the server-side before invoking Groq. UI-level character validation is bypassable and insufficient for token management.
- **System Prompt Limit:** System prompts must not exceed 800 tokens. If an agent requires more context, split the agent's responsibilities into two separate specialized agents.
- **Output Max Tokens:** Always enforce a strict `max_completion_tokens` parameter on the API request. Set this budget dynamically based on the specific model and the agent's task to prevent runaway generation.

---

## 3. System Prompt Structuring

Clean and efficient system prompts directly impact token usage and response accuracy.

- **Zero-Fluff Directives:** Eliminate conversational filler in system prompts. Use concise commands instead of polite requests.
- **Format Specifications:** The response format must exactly match the consuming agent's requirements. For the orchestrator contract, require strict schema-constrained JSON and explicitly prohibit Markdown to prevent downstream `JSON.parse()` errors.
- **Role Definition:** Clearly state the agent's exact role in the first sentence to heavily weight its attention mechanism, reducing the need for repeated instructions throughout the prompt.

---

## 4. Prompt Caching Strategy

While Groq processes tokens extremely fast, re-sending static data is inefficient.

- **Static System Prompts:** Store static system prompts in environment variables or a constant configuration file. Keep stable instructions at the very beginning of the prompt so Groq can automatically cache the exact prefix.
- **Redis Caching:** Cache identical user queries securely. To prevent returning stale data or breaching tenant boundaries, scope Redis cache keys to the complete authorized request. This must include the tenant/user scope, model, system-prompt version, context state, and locale. Only return a cache hit after completing all authorization checks.
