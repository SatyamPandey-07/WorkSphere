# Multi-Agent Chatbot Token Optimization Directives

This document outlines the strict directives for managing and optimizing token consumption when interacting with the Groq LLM API in the WorkSphere multi-agent chatbot system.

---

## 1. Prompt Context Reduction Rules

Sending the entire conversation history to the LLM for every request leads to massive token waste and API rate limits. Implement the following rules for context reduction:

- **Rolling Window Context:** Only send the last 5 to 7 conversational turns (user/assistant pairs) to the LLM.
- **Dynamic Summarization:** Once the conversation exceeds 10 turns, trigger a background agent to generate a concise summary of the older context. Append this summary to the system prompt and clear the older messages.
- **State-Based Pruning:** Remove system acknowledgments, filler words, or UI-specific JSON responses from the context array before sending it back to the API.

---

## 2. Message Length Constraints

To prevent malicious token draining and maintain fast inference speeds on Groq, enforce the following constraints at the application level:

- **User Input Limit:** Restrict user message inputs to a maximum of 500 characters. Implement UI-level validation to block oversized inputs.
- **System Prompt Limit:** System prompts must not exceed 800 tokens. If an agent requires more context, split the agent's responsibilities into two separate specialized agents.
- **Output Max Tokens:** Always enforce a strict `max_tokens` parameter (e.g., 300 to 500) on the API request to prevent runaway generation.

---

## 3. System Prompt Structuring

Clean and efficient system prompts directly impact token usage and response accuracy.

- **Zero-Fluff Directives:** Eliminate conversational filler in system prompts. Use concise commands instead of polite requests.
- **Format Specifications:** Explicitly define the output format using tight JSON schemas or Markdown structures to prevent the LLM from generating unnecessary explanatory text.
- **Role Definition:** Clearly state the agent's exact role in the first sentence to heavily weight its attention mechanism, reducing the need for repeated instructions throughout the prompt.

---

## 4. Prompt Caching Strategy

While Groq processes tokens extremely fast, re-sending static data is inefficient.

- **Static System Prompts:** Store static system prompts in environment variables or a constant configuration file to avoid regenerating them dynamically on every request.
- **Redis Caching:** Cache identical user queries. Before sending a query to the Groq API, hash the prompt and check if an exact match exists in the Redis cache. If it exists and is less than 24 hours old, return the cached response instead of hitting the API.
