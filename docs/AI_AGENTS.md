# AI Multi-Agent Architecture Guide

This document explains the multi-agent AI logic used in WorkSphere, detailing how prompts flow between agents, how to modify system prompts, and how to trace telemetry logs locally. 

The core of our AI logic is located in `src/app/api/chat/route.ts`.

## 1. Agent Architecture

WorkSphere utilizes a sequential, specialized multi-agent pipeline to process user requests, fetch data, reason over that data, and return actionable UI updates. 

When a user submits a message, the request flows through the following agents:

1. **Orchestrator Agent**: 
   - **Role**: Acts as the traffic controller. It analyzes the user's message and determines which downstream agents to trigger based on the intent's "complexity".
   - **Bypass**: If the user is just making general conversation, the Orchestrator can flag `skipAgents: true` to bypass the specialized pipeline and directly return a conversational LLM response.
   - **Output**: Returns a JSON object with `agentsToUse`, `complexity`, and basic search parameters (if simple).

2. **Context Agent**:
   - **Role**: Triggered if the query is complex or needs deep parameter extraction. It reads the user's message, location, and past memory profiles (via `MemoryAgent.ts`).
   - **Output**: Extracts highly detailed search parameters (e.g., `workType`, `amenities`, `radius`, `category`, `timeOfDay`).

3. **Data Agent**:
   - **Role**: Takes the parameters from the Context (or Orchestrator) agent and makes external API calls (e.g., fetching places from the Overpass API). It acts as the data retrieval layer.
   - **Output**: A raw array of venues/workspaces matching the location and basic filters.

4. **Reasoning Agent**:
   - **Role**: The core ranking engine. It takes the raw venues and applies weighted scoring based on the user's `workType` (e.g., focus vs. collaboration) and explicitly requested amenities (like quiet zones or fast WiFi). It also enriches the data with database ratings if available.
   - **Output**: A sorted, ranked list of venues with calculated scores.

5. **Action Agent**:
   - **Role**: The presentation layer. It takes the ranked venues and formulates a human-readable summary, generates suggested follow-up questions, and structures the `mapUpdates` JSON (markers and view center) to reflect changes on the frontend UI.
   - **Output**: Final message, UI components/markers, and suggestions.

## 2. Prompt Modifications

To modify how an agent behaves or to add new capabilities, you must update the specific agent's `systemPrompt`.

- **Where to find them**: Open `src/app/api/chat/route.ts` and locate the agent functions (e.g., `orchestratorAgent`, `contextAgent`).
- **Modifying the Orchestrator**: If you want to add a brand-new agent (e.g., a "Booking Agent"), you must first update the Orchestrator's `systemPrompt` so it knows when to include your new agent in the `agentsToUse` array.
- **Updating Capabilities**: If you want the Context Agent to extract a new parameter (e.g., "requiresWheelchairAccess"), add it to the extraction list in the `systemPrompt` of `contextAgent` and update the expected JSON output format in the prompt.
- **Tip**: Always instruct the LLM to output ONLY valid JSON in the system prompt to prevent Markdown formatting issues during JSON parsing.

## 3. Telemetry and Logs

Tracing LLM inputs and outputs locally is essential for debugging prompt flows.

- **Console Logs**: Throughout `src/app/api/chat/route.ts`, standard `console.log()` statements (e.g., `console.log("Running Orchestrator Agent...");`) are used to trace the execution step-by-step. Keep an eye on your backend terminal when submitting queries.
- **Tracing Inputs/Outputs**: 
  - Each agent's function generally wraps the Groq/LLM call in a `try/catch` block.
  - If you need to trace the exact prompt sent to the LLM, you can `console.log(systemPrompt)` before the `getGroqClient().chat.completions.create` call.
  - The API route builds an `agentSteps` array containing the metadata, latencies, and output of each executed agent. This is passed down to the frontend, which is useful for debugging the pipeline directly from the browser's Network tab.
