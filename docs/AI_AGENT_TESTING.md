# Testing AI Multi-Agent Systems with Mock Inputs

This guide explains how to test WorkSphere's AI agent pipeline using Jest and mock inputs without making real requests to external AI services.

The project follows a multi-agent architecture where different agents work together to process user requests. During testing, external dependencies such as the Groq API should be mocked so that tests remain fast, reliable, and repeatable.

This guide covers:

- Mocking Groq API responses
- Testing agent orchestration logic
- Validating prompt structures
- Running the agent test suite with Jest
- Common debugging and testing practices

---

# Prerequisites

Before writing or running tests, make sure your development environment is ready.

Requirements:

- Node.js installed
- Project dependencies installed
- Jest configured in the project
- Basic understanding of the AI agent pipeline

Install project dependencies if needed:

```bash
npm install
```

Run the existing test suite to verify your setup:

```bash
npm test
```

The project already includes a Jest configuration, so no additional testing framework setup is required.

---

# Understanding the Multi-Agent Pipeline

Before writing tests, it is important to understand how requests move through the AI pipeline.

The core implementation is located in:

```text
src/app/api/chat/route.ts
```

A single user request passes through multiple agents, where each agent is responsible for one stage of the workflow.

| Agent | Responsibility |
|--------|----------------|
| Orchestrator Agent | Determines the user's intent and decides which agents should run. |
| Context Agent | Extracts structured search parameters from the user's request. |
| Data Agent | Retrieves the required workspace or venue data. |
| Reasoning Agent | Ranks and scores the retrieved results based on user preferences. |
| Action Agent | Builds the final response, suggested actions, and UI updates. |

Because each agent has a specific responsibility, unit tests should focus on validating the behavior of a single agent instead of testing the complete pipeline in one test.

When testing the orchestration flow, mock the responses returned by downstream agents instead of making real API requests. This keeps tests predictable and allows failures to be isolated more easily.

---

# Mocking Groq Responses

Unit tests should not make real requests to the Groq API. Instead, mock the SDK so tests remain fast, deterministic, and independent of network availability.

WorkSphere already includes an example of this approach in:

```text
src/__tests__/lib/agents/MemoryAgent.test.ts
```

The test replaces the Groq client with a mocked implementation that returns a predefined response.

Example:

```ts
jest.mock("groq-sdk", () => ({
  Groq: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "Mock response",
              },
            },
          ],
        }),
      },
    },
  })),
}));
```

Mocking the SDK provides several benefits:

- Tests run without an active internet connection.
- Results remain consistent across multiple test runs.
- API usage limits are not consumed during development.
- Tests execute significantly faster than live API requests.

Whenever possible, return predictable mock responses that match the structure returned by the real Groq API. This makes it easier to verify how each agent processes AI-generated output without depending on an external service.

---

# Testing the Orchestrator Pipeline

The Orchestrator Agent is responsible for deciding which agents should participate in a request. Since it controls the overall workflow, tests should verify its decision-making logic without relying on external services.

A good orchestrator test should confirm that:

- The correct agents are selected for the user's request.
- Simple conversations can bypass the full pipeline when appropriate.
- Search parameters are passed to downstream agents correctly.
- The returned JSON structure matches the expected format.

When testing the orchestrator, replace downstream agent responses with mocked data instead of executing the complete pipeline. This keeps each test focused on orchestration logic rather than individual agent implementations.

For example, if the orchestrator selects the Context Agent and Data Agent, provide predefined responses for both agents and verify that the orchestrator combines those results correctly.

Typical assertions include:

- The expected agent sequence is selected.
- Required fields such as `agentsToUse` are present.
- Search parameters are generated correctly.
- Invalid or incomplete responses are handled gracefully.

Keeping orchestration tests isolated makes failures easier to diagnose and prevents unrelated agent changes from affecting existing tests.

---

# Validating Prompt Structures

Each agent in the pipeline relies on a system prompt to define its role and expected output. When modifying prompts or adding new capabilities, validate the prompt structure before testing the complete workflow.

The system prompts for the AI pipeline are defined in:

```text
src/app/api/chat/route.ts
```

When testing prompt behavior, verify the following:

- The system prompt clearly defines the agent's responsibility.
- Required variables are included before the request is sent.
- The expected response format is described explicitly.
- Instructions remain consistent across different execution paths.

For agents that return structured data, validate that the generated response follows the expected JSON schema. Tests should confirm that required fields are present and that the application can safely handle missing or invalid values.

Example checks include:

- Required fields exist in the response.
- JSON can be parsed successfully.
- Optional fields are handled correctly.
- Invalid responses do not break the agent pipeline.

Whenever a prompt is updated, review the related unit tests to ensure the expected response structure still matches the implementation.

---

# Running the Test Suite

WorkSphere uses **Jest** for unit testing AI agents and supporting modules.

Run the complete test suite:

```bash
npm test
```

Run tests in watch mode during development:

```bash
npm run test:watch
```

To execute a specific test file, provide its path to Jest:

```bash
npx jest src/__tests__/lib/agents/MemoryAgent.test.ts
```

Running individual tests is useful when working on a single agent because it provides faster feedback and makes debugging easier.

---

# Testing the Agent Pipeline

When testing AI agents, focus on one responsibility at a time instead of validating the entire pipeline in every test.

A typical testing workflow includes:

1. Mock external services such as the Groq SDK.
2. Provide predictable mock inputs.
3. Execute the target agent.
4. Verify the returned result.
5. Confirm that dependent services are called with the expected arguments.

For example, when testing the Memory Agent, verify that:

- Database queries are executed correctly.
- The Groq client receives the expected prompt.
- The mocked AI response is processed successfully.
- User preferences are updated with the generated summary.

This approach keeps tests isolated, easier to maintain, and less affected by changes in other parts of the AI pipeline.

---

# Best Practices

Following a few testing practices can make AI agent tests more reliable and easier to maintain.

- Mock external services instead of making real API calls.
- Keep each test focused on a single agent or responsibility.
- Use predictable mock data so test results remain consistent.
- Validate both successful and failure scenarios.
- Update tests whenever prompt structures or response formats change.
- Avoid sharing state between test cases by clearing mocks before each test.
- Keep test data small and easy to understand.

Following these practices helps prevent flaky tests and makes debugging much easier as the AI pipeline evolves.

---

# Troubleshooting

## Groq API is called during tests

Verify that the Groq SDK is mocked correctly using `jest.mock("groq-sdk")`. Unit tests should never depend on live API requests.

---

## Tests return different results each time

Review your mock responses and test data. Every test should use deterministic inputs so the expected output remains consistent.

---

## JSON parsing errors

If an agent expects structured JSON, verify that the mocked response follows the same structure returned by the real implementation. Invalid mock data can produce misleading test failures.

---

## Prompt changes break existing tests

Whenever a system prompt is updated, review the related unit tests and update the expected response if the output structure has changed.

---

## Database calls fail during tests

Mock database queries instead of connecting to a real database. Existing tests such as `src/__tests__/lib/agents/MemoryAgent.test.ts` demonstrate this approach.

---

# Summary

WorkSphere's AI pipeline is designed around independent agents that each perform a specific task. By mocking external services, validating prompt structures, and testing each agent in isolation, contributors can build reliable tests without depending on external APIs or network connectivity.

Keeping tests small, predictable, and focused makes the AI workflow easier to maintain and improves confidence when introducing new features or modifying existing agents.