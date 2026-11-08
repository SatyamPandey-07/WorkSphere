# Gemini Integration Guide

The app uses Google's Gemini models through the `@google/genai` SDK for
server-side text generation that is a poor fit for the Groq chat models. The
client lives in `src/lib/ai/gemini.ts` and is currently used by the venue
summary endpoint.

## Configuration

Set the API key in `.env.local` (or the deployment environment):

```env
GEMINI_API_KEY=your-gemini-api-key
```

Get a key from Google AI Studio. The variable is read once per request inside
`getGeminiClient()`; if it is missing the call throws before touching the
network with the message `GEMINI_API_KEY is not configured`. That makes the
failure obvious in logs instead of surfacing as an opaque 401 from Google.

## Models

`src/lib/ai/gemini.ts` pins a single model id so every caller stays in sync:

| Model              | Use                                            |
| ------------------ | ---------------------------------------------- |
| `gemini-3.6-flash` | Default for text generation and summarization  |

To move to a newer model, change the id in `gemini.ts` and confirm the
`@google/genai` version in `package.json` still supports it. Flash-tier models
are chosen here because summaries are latency sensitive and do not need deep
reasoning.

## Basic usage

```ts
import { generateGeminiText } from "@/lib/ai/gemini";

const summary = await generateGeminiText(
  "Summarize this venue in one sentence: quiet cafe, strong WiFi, outlets at every table.",
);
```

`generateGeminiText(prompt: string)` returns the trimmed response text. It
throws when the model returns an empty or whitespace-only body, so callers can
distinguish "no content" from a transport error.

The function resolves the client on each call rather than at module load. That
keeps the module importable in tests and in environments where the key is only
present at request time.

## Error handling

Wrap calls in try/catch and return a stable HTTP status to the caller instead
of leaking provider messages:

```ts
try {
  const summary = await generateGeminiText(prompt);
  return Response.json({ summary });
} catch (error) {
  console.error("Gemini summary failed:", error);
  return Response.json({ error: "Failed to generate venue summary" }, { status: 500 });
}
```

The three failures worth handling explicitly:

1. Missing key - thrown locally, no network call. Treat as a configuration bug.
2. Empty response - thrown after a successful call. Usually a safety filter or a
   prompt that produced no text; log the prompt and retry with clearer input.
3. Provider errors - quota, rate limit, or network. The SDK throws the upstream
   error; do not retry in a tight loop.

The venue summary route (`src/app/api/venues/[venueId]/summary/route.ts`) is the
reference implementation of this pattern.

## Rate limits and quotas

Gemini enforces per-project quotas. A 429 from the SDK is not retried
automatically. If a caller needs resilience, add a bounded retry with backoff
around `generateGeminiText`, and fall back to a deterministic message rather
than failing the whole request.

## Testing

Unit tests mock the SDK so they never hit the network. Mock the module under
test rather than the SDK when possible:

```ts
jest.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: jest.fn(),
}));
```

`src/__tests__/api/venueSummary.test.ts` shows the full setup, including the
404 and 500 paths. When you want to exercise `gemini.ts` itself, mock
`@google/genai`.

Note: `@google/genai` ships both a browser ESM bundle and a Node CJS build.
Under jsdom, Jest resolves the browser bundle and fails to load it, so
`jest.config.js` maps the package to `dist/node/index.cjs`. Keep that mapping
in place if you write new tests that import the client.

## Troubleshooting

| Symptom                        | Likely cause                                              |
| ------------------------------ | --------------------------------------------------------- |
| `GEMINI_API_KEY is not configured` | Key missing from the active env file                 |
| 401 from the provider          | Key revoked or wrong project                              |
| 429 immediately                | Quota exhausted for the project                           |
| `Gemini returned an empty response` | Safety filter or an empty prompt                     |
| Jest error about ES modules    | Missing `@google/genai` mapping in `jest.config.js`       |
