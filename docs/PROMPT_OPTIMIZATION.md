# Prompt Optimization Guide

This document explains how to optimize prompts and configure Groq Large Language Models (LLMs) used in WorkSphere. It provides guidance on parameter tuning, system prompt design, and response evaluation to improve response quality, consistency, and reliability.

---

## 1. Groq Parameters

Groq models expose several configuration parameters that influence response behavior. Choosing appropriate values depends on the use case.

### Temperature

The `temperature` parameter controls how deterministic or creative the model's responses are.

| Temperature | Recommended Use |
|-------------|-----------------|
| 0.0 – 0.2 | Deterministic tasks, factual answers, code generation |
| 0.3 – 0.6 | General conversations and assistants |
| 0.7 – 1.0 | Brainstorming and creative writing |

### Best Practices

- Use low temperature for API responses and structured JSON generation.
- Use medium temperature for general chat interactions.
- Use higher temperatures only when creative or diverse responses are required.
- When expecting structured output, combine a low temperature with explicit formatting instructions.

---

### Max Tokens

The `max_tokens` parameter limits the maximum length of the generated response.

| Max Tokens | Recommended Use |
|------------|-----------------|
| 256 | Short answers |
| 512 | Standard chatbot responses |
| 1024 | Detailed explanations |
| 2048+ | Documentation and long-form content |

### Best Practices

- Select the smallest value that satisfies the expected response length.
- Larger values increase latency and token usage.
- Avoid unnecessarily high limits for simple requests.

---

## 2. System Prompt Templates

A well-designed system prompt provides clear instructions and helps produce consistent responses.

### Recommended Structure

A system prompt should define:

- Agent role
- Primary objective
- Available context
- Constraints
- Output format

### Example Template

```text
Role:
You are an AI assistant for WorkSphere.

Objective:
Help users find suitable workspaces and answer questions accurately.

Constraints:
- Provide concise responses.
- Do not invent information.
- Return valid JSON whenever structured output is requested.

Output Format:
- Markdown for conversational responses.
- JSON only when required by the application.
```

### Prompt Design Guidelines

- Clearly define the agent's responsibility.
- Keep instructions concise and unambiguous.
- Specify formatting requirements explicitly.
- Include constraints to reduce hallucinations.
- Request valid JSON for machine-readable outputs.

---

## 3. Response Evaluation

Prompt optimization should include regular evaluation of generated responses.

### Evaluation Criteria

- **Accuracy** – Information is factually correct.
- **Relevance** – Response addresses the user's request.
- **Completeness** – Required information is included.
- **Consistency** – Similar prompts produce consistent results.
- **Clarity** – Responses are easy to understand.
- **Safety** – Responses avoid harmful or unsupported content.

### Evaluation Checklist

Before deploying prompt changes, verify that:

- The response answers the user's request.
- Output formatting matches expectations.
- JSON responses are valid and parse correctly.
- Responses remain consistent across repeated tests.
- The model avoids unsupported assumptions.

---

## Best Practices

- Write clear and specific system prompts.
- Prefer explicit instructions over vague requests.
- Keep prompts focused on a single objective.
- Use low temperatures for deterministic tasks.
- Test prompts using multiple input variations.
- Continuously refine prompts based on evaluation results.

---

## Conclusion

Well-structured system prompts, appropriate Groq parameter settings, and consistent response evaluation significantly improve the quality, reliability, and predictability of AI-generated responses within WorkSphere.