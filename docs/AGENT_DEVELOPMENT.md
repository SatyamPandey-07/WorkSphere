# WorkSphere Agent Development Guide

This guide is for developers who want to extend WorkSphere's Multi-Agent AI pipeline — whether that means tweaking prompts, adding a brand-new agent (e.g. an `ExpenseAgent`), or debugging why an agent isn't behaving as expected.

For a full conceptual overview of the existing pipeline (Orchestrator → Context → Data → Reasoning → Action), prompts, and data schemas, see [`ARCHITECTURE.md`](./ARCHITECTURE.md) first. This guide picks up from there and focuses on **extending** the system.

---

## 1. Pipeline Architecture (Quick Recap)

At a high level, a chat request flows through `src/app/api/chat/route.ts` like this:

```
Client Query → orchestratorAgent() → contextAgent() → dataAgent() → reasoningAgent() → actionAgent() → Client Response
```

- `orchestratorAgent()` decides *which* agents are actually needed for a given message (e.g. a simple "hello" skips the whole pipeline).
- `contextAgent()`, `dataAgent()`, `reasoningAgent()`, and `actionAgent()` are called in sequence, each one passing its JSON output as input to the next.

Two things are important to understand before adding a new agent:

1. **Not all agents live in the same place.** The 5 pipeline agents above are implemented as plain functions inside `src/app/api/chat/route.ts`. Separately, `src/lib/agents/` contains standalone, single-purpose agents (`MemoryAgent.ts`, `VisionAgent.ts`) that are *not* part of the main chat pipeline — they're called directly from other routes/components when needed.
2. **Every agent talks to the Groq LLM the same way**: build a system prompt that ends with an explicit instruction to output *only* valid JSON, call `groq.chat.completions.create(...)`, then parse the result.

Choose the pattern below that matches what you're building.

---

## 2. Adding a New Agent

### Option A — Adding to the core chat pipeline (e.g. a new step between Data and Reasoning)

Use this pattern if your agent needs to participate in every search request, alongside Context/Data/Reasoning/Action.

1. **Write the agent function** inside `src/app/api/chat/route.ts`, following the existing style:
   ```typescript
   async function myNewAgent(input: SomeInputType): Promise<SomeOutputType> {
     const systemPrompt = `You are the MyNew Agent. <describe its one job>.

   Output ONLY valid JSON:
   {"exampleField": "..."}`;

     const groq = getGroqClient();
     const completion = await groq.chat.completions.create({
       messages: [
         { role: 'system', content: systemPrompt },
         { role: 'user', content: JSON.stringify(input) },
       ],
       model: 'llama-3.3-70b-versatile',
       temperature: 0,
     });

     const text = completion.choices[0]?.message?.content || '';
     const jsonMatch = text.match(/\{[\s\S]*\}/);
     if (jsonMatch) return JSON.parse(jsonMatch[0]);
     throw new Error('MyNewAgent: failed to parse JSON response');
   }
   ```

2. **Register it with the Orchestrator.** Find the `orchestratorAgent()` function's system prompt (search for `"You are the Orchestrator Agent"`). Add your agent's name to the `Available agents` list and the routing `Rules`, and add it to the JSON output template, e.g.:
   ```
   - MyNewAgent: <one-line description of what it decides or extracts>
   ```

3. **Wire it into the `POST` handler.** Inside `export async function POST(req: Request)`, find where the pipeline agents are called in sequence (look for the `console.log("Running X Agent...")` lines). Add your call in the right position, gated by whether the orchestrator included it in `agentsToUse`:
   ```typescript
   let myNewResult;
   if (orchestratorResult.agentsToUse.includes("MyNewAgent")) {
     console.log("Running MyNew Agent...");
     myNewResult = await myNewAgent(previousAgentOutput);
   }
   ```

4. **Update `ARCHITECTURE.md`** with your agent's prompt, input/output schema, and its place in the Mermaid pipeline diagram, so the conceptual docs stay in sync with the code.

### Option B — Adding a standalone agent (not part of every request)

Use this pattern if your agent is only invoked for a specific feature — this is how `MemoryAgent.ts` (extracts long-term preferences from a conversation) and `VisionAgent.ts` (analyzes an uploaded venue photo) are built.

1. Create a new file: `src/lib/agents/YourAgentName.ts`
2. Initialize your own Groq client at the top of the file (matching the existing lazy-init pattern with a `dummy-key-for-build` fallback so it doesn't break the production build if the env var isn't set yet):
   ```typescript
   import Groq from 'groq-sdk';

   const groq = new Groq({
     apiKey: process.env.GROQ_API_KEY || 'dummy-key-for-build',
   });
   ```
3. Export a single async function that does the agent's one job, taking typed input and returning a typed result — see `analyzeVenueImage()` in `VisionAgent.ts` for a clean example, including a safe fallback return value inside a `catch` block so a failed AI call doesn't crash the calling route.
4. Import and call your function from wherever it's needed (an API route or component), the same way `MemoryAgent.ts`'s `extractAndStoreMemories()` is called after a conversation ends.

---

## 3. Prompt Debugging

When an agent isn't returning what you expect, work through these steps:

1. **Log the raw prompt and raw response.** Every agent function already has a `console.log("Running X Agent...")` line before its Groq call — temporarily add two more right after you get `completion`:
   ```typescript
   console.log("Prompt sent:", systemPrompt);
   console.log("Raw Groq output:", completion.choices[0]?.message?.content);
   ```
   This tells you immediately whether the problem is in your prompt wording or in your parsing logic.

2. **Watch for non-JSON wrapping.** Groq/Llama models sometimes wrap JSON in markdown code fences or add a sentence before it (e.g. `"Here is your JSON response: {...}"`). This is why every agent extracts JSON with a regex before parsing:
   ```typescript
   const jsonMatch = text.match(/\{[\s\S]*\}/);
   ```
   If parsing fails, log `text` directly to see exactly what came back before your regex touched it.

3. **Set `temperature: 0`** while debugging. All existing pipeline agents use `temperature: 0` for deterministic, repeatable output — if you're testing a new prompt, keep this low so the same input reliably produces the same output while you iterate.

4. **Check the Orchestrator's routing decision first.** If your new agent never seems to run, don't assume it's the agent's own logic — first confirm the Orchestrator actually included it in `agentsToUse`. Add a `console.log(orchestratorResult)` right after the orchestrator call to check.

5. **Test agents independently before wiring them into the pipeline.** Write a small standalone script (or a temporary test API route) that calls just your new agent function with a fixed sample input, so you're not re-running the entire 5-agent chain every time you tweak a prompt.

---

## 4. Checklist Before Opening a PR

- [ ] New agent function follows the existing JSON-only prompt + regex-parse pattern
- [ ] If added to the core pipeline: Orchestrator prompt and routing rules updated
- [ ] `ARCHITECTURE.md` updated with the new agent's prompt/schema (if it's a pipeline agent)
- [ ] Debug `console.log` statements added during development are removed or reduced to match existing logging style before committing
- [ ] Tested with `temperature: 0` for at least one deterministic sample input
