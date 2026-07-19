# Custom AI Agent Tools

## Overview

This document explains how to extend the application's multi-agent AI system by creating custom AI agents and integrating them into the existing orchestration pipeline.

The current architecture uses multiple specialized agents that each perform a single responsibility. Rather than relying on built-in LLM function calling, the application coordinates agents through the backend request pipeline, allowing each agent to focus on a specific task.

---

## Multi-Agent Architecture

The AI request pipeline follows this sequence:

```text
User Request
      │
      ▼
Orchestrator Agent
      │
      ▼
Context Agent
      │
      ▼
Data Agent
      │
      ▼
Data Enrichment
      │
      ▼
Reasoning Agent
      │
      ▼
Action Agent
      │
      ▼
Streaming Response
```

Additional specialized agents include:

- Memory Agent
- Vision Agent

Each agent is responsible for a single task and communicates using structured data.

---

## Existing Agent Responsibilities

| Agent              | Responsibility                                                        |
| ------------------ | --------------------------------------------------------------------- |
| Orchestrator Agent | Determines which agents should run for the current request.           |
| Context Agent      | Extracts user intent and search parameters.                           |
| Data Agent         | Retrieves workspace or venue information from supported data sources. |
| Data Enrichment    | Enhances retrieved data with application-specific information.        |
| Reasoning Agent    | Scores, ranks, and evaluates results.                                 |
| Action Agent       | Generates the final response and UI updates.                          |
| Memory Agent       | Extracts and retrieves long-term user preferences.                    |
| Vision Agent       | Performs image analysis and structured validation.                    |

---

# Creating a Custom AI Agent

## Step 1 – Create the Agent

Create a new file inside:

```text
src/lib/agents/
```

Example:

```text
src/lib/agents/AccessibilityAgent.ts
```

Keep each agent focused on a single responsibility.

---

## Step 2 – Define Clear Input and Output

Every agent should accept well-defined inputs and return structured data.

Example:

```ts
interface AccessibilityResult {
  wheelchairAccessible: boolean;
  elevatorAvailable: boolean;
  confidence: number;
}

export async function accessibilityAgent(
  input: string,
): Promise<AccessibilityResult> {
  // Agent logic
}
```

Returning structured objects makes it easier for downstream agents to consume the results.

---

## Step 3 – Implement Agent Logic

An agent may:

- Analyze user input.
- Process application data.
- Call an LLM when reasoning is required.
- Query external services when appropriate.
- Perform deterministic calculations.

Prefer deterministic logic whenever possible and reserve LLM calls for tasks requiring natural language understanding or reasoning.

---

## Step 4 – Integrate with the Orchestrator

Update the orchestration logic so it can decide when the new agent should execute.

Example workflow:

```text
If user requests accessibility information

↓

Run Accessibility Agent

↓

Merge results into the final response
```

The orchestrator should only invoke agents that are required for the current request.

---

## Step 5 – Use Agent Output

The output of the custom agent can be:

- Included in later reasoning.
- Combined with other agent results.
- Added to generated responses.
- Used for UI updates.
- Stored for future processing if applicable.

Each agent should expose structured results instead of formatted text whenever possible.

---

# Example Custom Agent

Example:

```ts
interface WeatherResult {
  condition: string;
  temperature: number;
}

export async function weatherAgent(location: string): Promise<WeatherResult> {
  return {
    condition: "Sunny",
    temperature: 28,
  };
}
```

The orchestrator can execute this agent whenever weather information is required.

---

## Agent Design Principles

Follow these principles when creating new agents.

### Single Responsibility

Each agent should perform one specific task.

Good examples:

- Image analysis
- Search parameter extraction
- Ranking results
- Preference extraction

Avoid combining unrelated responsibilities into a single agent.

---

### Structured Responses

Prefer returning structured objects.

Good:

```ts
{
  score: 92,
  confidence: 0.96
}
```

Avoid returning large blocks of text that require additional parsing.

---

### Input Validation

Validate inputs before processing.

Examples:

- Required values exist.
- Numeric ranges are valid.
- Optional fields are handled safely.

Gracefully return fallback responses when validation fails.

---

### Error Handling

Agents should handle failures without interrupting the entire pipeline.

Recommendations:

- Catch expected errors.
- Log useful debugging information.
- Return safe fallback values when appropriate.
- Avoid exposing internal implementation details.

---

### Performance

To maintain responsive interactions:

- Avoid unnecessary LLM requests.
- Reuse cached results when available.
- Keep prompts concise.
- Minimize redundant processing.

---

### Prompt Design

When using an LLM:

- Clearly define the agent's role.
- Request structured output.
- Keep prompts focused on a single objective.
- Include explicit formatting instructions when structured responses are expected.

---

## Testing

Before integrating a new agent:

- Verify valid inputs produce expected outputs.
- Test invalid or missing inputs.
- Confirm fallback behavior.
- Verify integration with the orchestration pipeline.
- Test interactions with downstream agents.

Whenever possible, mock external dependencies during unit testing.

---

## Best Practices

- Keep agents modular.
- Follow a single-responsibility design.
- Use descriptive interfaces.
- Return predictable data structures.
- Handle failures gracefully.
- Prefer reusable logic over duplication.
- Keep orchestration logic simple.
- Document the purpose of each agent.

---

## Summary

The application's AI architecture is built around specialized agents that collaborate through an orchestration pipeline. Adding a new capability typically involves creating a focused agent, defining clear input and output contracts, integrating it into the orchestration flow, and ensuring that it returns structured results for downstream processing. Following these guidelines helps maintain a modular, scalable, and maintainable multi-agent system.
