import Groq from "groq-sdk";
import {
  getGeminiClient,
  isGeminiConfigured,
  GEMINI_MODEL,
} from "@/lib/ai/gemini";

export const GROQ_MODEL = "llama-3.3-70b-versatile";
export { GEMINI_MODEL };

export type AIProvider = "groq" | "gemini";
export type QueryComplexity = "simple" | "complex";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  model?: string;
  maxTokens?: number;
}

export interface StreamOptions extends CompletionOptions {
  onChunk: (text: string) => void;
}

export interface RoutedResult {
  text: string;
  provider: AIProvider;
  fallbackUsed?: boolean;
}

/** Check if Groq API credentials are available */
export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/** Check if a specific AI provider is configured */
export function isProviderConfigured(provider: AIProvider): boolean {
  if (provider === "groq") return isGroqConfigured();
  if (provider === "gemini") return isGeminiConfigured();
  return false;
}

let groqInstance: Groq | null = null;

/** Retrieves or instantiates the Groq SDK client */
export function getGroqClient(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured");
  }
  if (!groqInstance) {
    groqInstance = new Groq({
      apiKey: process.env.GROQ_API_KEY,
      // Fail fast on sustained 429s instead of hanging the request
      maxRetries: 2,
      timeout: 20000,
    });
  }
  return groqInstance;
}

/**
 * Checks whether an error represents an HTTP 429 rate limit or quota exhaustion
 * across Groq and Google Gemini.
 */
export function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    error?.status === 429 ||
    error?.statusCode === 429 ||
    error?.name === "RateLimitError" ||
    error?.status === "RESOURCE_EXHAUSTED" ||
    error?.code === 429 ||
    error?.error?.code === 429 ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("resource_exhausted") ||
    message.includes("quota") ||
    message.includes("too many requests")
  );
}

/**
 * Classifies user query complexity into "simple" or "complex" using deterministic,
 * local rules without issuing secondary LLM requests.
 *
 * Signal Rationale:
 * 1. Comparison terms: Queries comparing multiple venues or weighing trade-offs
 *    require parallel evaluation of attributes, best handled by Gemini.
 * 2. Planning & multi-step requests: Itinerary or workday schedules require
 *    synthesizing multi-phase constraints over time.
 * 3. Synthesis & analytical language: Requests to synthesize or rank multiple items
 *    require contextual reasoning.
 * 4. Multi-constraint reasoning: Lookups specifying 3+ distinct dimensions
 *    (e.g., quiet + 100mbps wifi + outlets + outdoor) require combinatorial evaluation.
 * 5. Query length: Long queries (>180 chars or >30 words) typically convey complex
 *    narratives or multi-part instructions.
 * 6. Context size: Deep conversation history (>= 6 messages or >500 chars) requires
 *    multi-turn contextual synthesis.
 * 7. Default (Simple): Short factual queries, single/dual filter requests, navigation
 *    lookups, and greetings route to Groq for ultra-low latency response.
 */
export function classifyQueryComplexity(
  query: string,
  context?: unknown,
): QueryComplexity {
  if (!query || typeof query !== "string") {
    return "simple";
  }

  const text = query.trim().toLowerCase();

  // 1. Long context check: multi-turn synthesis
  if (context) {
    if (typeof context === "string" && context.length > 500) {
      return "complex";
    }
    if (Array.isArray(context)) {
      if (context.length >= 6) return "complex";
      const totalChars = context.reduce((acc, item) => {
        if (typeof item === "string") return acc + item.length;
        if (item && typeof item === "object" && "content" in item) {
          return acc + String((item as any).content ?? "").length;
        }
        return acc;
      }, 0);
      if (totalChars > 500) return "complex";
    } else if (typeof context === "object") {
      const jsonStr = JSON.stringify(context);
      if (jsonStr.length > 500) return "complex";
    }
  }

  // 2. Query length check: lengthy instructions
  if (text.length > 180 || text.split(/\s+/).length > 30) {
    return "complex";
  }

  // 3. Comparison terms
  const COMPARISON_REGEX =
    /\b(compare|comparison|versus|vs\.?|difference between|pros and cons|which (?:is|one is) (?:better|best|quieter|cheaper|preferable)|better (?:between|than)|trade-?offs?)\b/i;
  if (COMPARISON_REGEX.test(text)) {
    return "complex";
  }

  // 4. Planning & multi-step workflow terms
  const PLANNING_REGEX =
    /\b(plan (?:my|a|the)|itinerary|schedule|workflow|step by step|agenda)\b/i;
  if (PLANNING_REGEX.test(text)) {
    return "complex";
  }

  // 5. Synthesis & analytical language
  const SYNTHESIS_REGEX =
    /\b(synthesiz\w*|break down|rank (?:all|these|the top \d+)|evaluate (?:all|both)|recommendations based on .* and .* and)\b/i;
  if (SYNTHESIS_REGEX.test(text)) {
    return "complex";
  }

  // 6. Multi-constraint reasoning: count distinct constraint categories
  let constraintCount = 0;
  if (/\b(wi-?fi|internet|bandwidth|mbps|fiber)\b/i.test(text)) constraintCount++;
  if (/\b(quiet|silent|peaceful|no music|deep work|noise)\b/i.test(text)) constraintCount++;
  if (/\b(outlets?|power|plug|socket|charg\w*)\b/i.test(text)) constraintCount++;
  if (/\b(ergonomic|standing desk|comfortable chair|monitor)\b/i.test(text)) constraintCount++;
  if (/\b(phone booth|call booth|zoom|meeting room|conference)\b/i.test(text)) constraintCount++;
  if (/\b(outdoor|patio|terrace|rooftop|balcony)\b/i.test(text)) constraintCount++;
  if (/\b(open late|24\s*hours?|early morning|overnight)\b/i.test(text)) constraintCount++;
  if (/\b(food|lunch|specialty coffee|vegan|snacks|kitchen|drinks)\b/i.test(text)) constraintCount++;
  if (/\b(free|budget|cheap|affordable|daily pass|pricing|membership)\b/i.test(text)) constraintCount++;

  if (constraintCount >= 3) {
    return "complex";
  }

  return "simple";
}

/** Returns the designated primary provider based on complexity */
export function getProviderForComplexity(complexity: QueryComplexity): AIProvider {
  return complexity === "complex" ? "gemini" : "groq";
}

/** Returns the failover counterpart provider */
export function getFallbackProvider(provider: AIProvider): AIProvider {
  return provider === "groq" ? "gemini" : "groq";
}

/** Returns default model string for a provider */
export function getModelForProvider(provider: AIProvider): string {
  if (provider === "groq") return GROQ_MODEL;
  if (provider === "gemini") return GEMINI_MODEL;
  throw new Error(`Unsupported AI provider: ${provider}`);
}

/** Formats chat messages for Google Gemini SDK contents format */
function formatGeminiContents(messages: ChatMessage[]): {
  contents: any;
  systemInstruction?: string;
} {
  const systemMessages = messages.filter((m) => m.role === "system");
  const systemInstruction = systemMessages.map((m) => m.content).join("\n\n");
  const nonSystem = messages.filter((m) => m.role !== "system");

  if (nonSystem.length === 0) {
    return {
      contents: systemInstruction || "Hello",
      systemInstruction: undefined,
    };
  }

  const contents = nonSystem.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  return {
    contents,
    systemInstruction: systemInstruction || undefined,
  };
}

/** Executes a non-streaming completion for a single provider */
export async function executeProviderCompletion(
  provider: AIProvider,
  options: CompletionOptions,
): Promise<string> {
  if (provider === "groq") {
    const client = getGroqClient();
    const model = options.model || GROQ_MODEL;
    const res = await client.chat.completions.create({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    });
    return res.choices[0]?.message?.content || "";
  }

  if (provider === "gemini") {
    const client = getGeminiClient();
    const model = options.model || GEMINI_MODEL;
    const { contents, systemInstruction } = formatGeminiContents(options.messages);

    const config: Record<string, unknown> = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (options.temperature !== undefined) config.temperature = options.temperature;
    if (options.maxTokens) config.maxOutputTokens = options.maxTokens;

    const res = await client.models.generateContent({
      model,
      contents,
      config: Object.keys(config).length > 0 ? config : undefined,
    });
    return res.text?.trim() || "";
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}

/** Executes a streaming completion for a single provider */
export async function executeProviderStream(
  provider: AIProvider,
  options: StreamOptions,
): Promise<string> {
  if (provider === "groq") {
    const client = getGroqClient();
    const model = options.model || GROQ_MODEL;
    const stream = await client.chat.completions.create({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.5,
      stream: true,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    });
    let fullText = "";
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) {
        options.onChunk(text);
        fullText += text;
      }
    }
    return fullText;
  }

  if (provider === "gemini") {
    const client = getGeminiClient();
    const model = options.model || GEMINI_MODEL;
    const { contents, systemInstruction } = formatGeminiContents(options.messages);

    const config: Record<string, unknown> = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (options.temperature !== undefined) config.temperature = options.temperature;
    if (options.maxTokens) config.maxOutputTokens = options.maxTokens;

    const responseStream = await client.models.generateContentStream({
      model,
      contents,
      config: Object.keys(config).length > 0 ? config : undefined,
    });

    let fullText = "";
    for await (const chunk of responseStream) {
      const text = chunk.text || "";
      if (text) {
        options.onChunk(text);
        fullText += text;
      }
    }
    return fullText;
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}

/**
 * Routes a chat completion between Groq and Gemini with automatic one-time 429 failover.
 */
export async function routeChatCompletion(
  options: CompletionOptions & {
    complexity?: QueryComplexity;
    userQuery?: string;
    context?: unknown;
    provider?: AIProvider;
  },
): Promise<RoutedResult> {
  const userMessage =
    options.userQuery ??
    options.messages.filter((m) => m.role === "user").at(-1)?.content ??
    "";
  const complexity =
    options.complexity ?? classifyQueryComplexity(userMessage, options.context);

  let primary: AIProvider;
  if (options.provider) {
    primary = options.provider;
  } else {
    const target = getProviderForComplexity(complexity);
    if (!isProviderConfigured(target) && isProviderConfigured(getFallbackProvider(target))) {
      primary = getFallbackProvider(target);
    } else {
      primary = target;
    }
  }

  const fallback = getFallbackProvider(primary);

  try {
    const text = await executeProviderCompletion(primary, options);
    return { text, provider: primary };
  } catch (error) {
    if (isRateLimitError(error) && isProviderConfigured(fallback)) {
      console.warn(
        `[AIRouter] ${primary} returned HTTP 429 rate limit. Failing over to ${fallback}.`,
      );
      const text = await executeProviderCompletion(fallback, options);
      return { text, provider: fallback, fallbackUsed: true };
    }
    throw error;
  }
}

/**
 * Routes a streaming chat completion with automatic one-time 429 failover.
 */
export async function routeChatStream(
  options: StreamOptions & {
    complexity?: QueryComplexity;
    userQuery?: string;
    context?: unknown;
    provider?: AIProvider;
  },
): Promise<RoutedResult> {
  const userMessage =
    options.userQuery ??
    options.messages.filter((m) => m.role === "user").at(-1)?.content ??
    "";
  const complexity =
    options.complexity ?? classifyQueryComplexity(userMessage, options.context);

  let primary: AIProvider;
  if (options.provider) {
    primary = options.provider;
  } else {
    const target = getProviderForComplexity(complexity);
    if (!isProviderConfigured(target) && isProviderConfigured(getFallbackProvider(target))) {
      primary = getFallbackProvider(target);
    } else {
      primary = target;
    }
  }

  const fallback = getFallbackProvider(primary);

  let chunksEmitted = false;
  const wrappedOnChunk = (chunk: string) => {
    chunksEmitted = true;
    options.onChunk(chunk);
  };

  try {
    const text = await executeProviderStream(primary, {
      ...options,
      onChunk: wrappedOnChunk,
    });
    return { text, provider: primary };
  } catch (error) {
    if (isRateLimitError(error) && isProviderConfigured(fallback) && !chunksEmitted) {
      console.warn(
        `[AIRouter] ${primary} returned HTTP 429 rate limit. Failing over to ${fallback}.`,
      );
      const text = await executeProviderStream(fallback, options);
      return { text, provider: fallback, fallbackUsed: true };
    }
    throw error;
  }
}
