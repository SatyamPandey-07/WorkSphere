import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const MAX_CONCIERGE_BODY_BYTES = 32 * 1024; // 32 KB hard payload ceiling
export const MAX_CONCIERGE_MESSAGES = 20;
export const MAX_MESSAGE_CONTENT_LENGTH = 2000;
export const CONCIERGE_RATE_LIMIT_MAX_REQUESTS = 15;
export const CONCIERGE_RATE_LIMIT_WINDOW_MS = 60_000;

export const ConciergeMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z
    .string({ required_error: 'Message content is required' })
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(
      MAX_MESSAGE_CONTENT_LENGTH,
      `Message content cannot exceed ${MAX_MESSAGE_CONTENT_LENGTH} characters`
    ),
});

export const VenueConciergeRequestSchema = z.object({
  messages: z
    .array(ConciergeMessageSchema, {
      required_error: 'messages array is required',
      invalid_type_error: 'messages must be an array',
    })
    .min(1, 'At least one conversation message is required')
    .max(
      MAX_CONCIERGE_MESSAGES,
      `Conversation history cannot exceed ${MAX_CONCIERGE_MESSAGES} messages`
    ),
  venueContext: z
    .object({
      venueId: z.string().max(128).optional(),
      venueName: z.string().max(200).optional(),
      city: z.string().max(120).optional(),
    })
    .optional(),
});

export type VenueConciergeRequest = z.infer<typeof VenueConciergeRequestSchema>;

interface SlidingWindowEntry {
  timestamps: number[];
}

// Per-user / per-IP sliding window log
const globalForConciergeRl = globalThis as unknown as {
  __worksphereConciergeRateLimit?: Map<string, SlidingWindowEntry>;
};

const slidingWindowStore =
  globalForConciergeRl.__worksphereConciergeRateLimit ??
  new Map<string, SlidingWindowEntry>();

if (!globalForConciergeRl.__worksphereConciergeRateLimit) {
  globalForConciergeRl.__worksphereConciergeRateLimit = slidingWindowStore;
}

export interface SlidingWindowCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  headers: Record<string, string>;
}

/**
 * Evaluates a strict sliding-window rate limit for `identifier` over `windowMs`.
 */
export function checkConciergeSlidingWindowRateLimit(
  identifier: string,
  nowMs: number = Date.now(),
  maxRequests: number = CONCIERGE_RATE_LIMIT_MAX_REQUESTS,
  windowMs: number = CONCIERGE_RATE_LIMIT_WINDOW_MS
): SlidingWindowCheckResult {
  const cutoff = nowMs - windowMs;
  const entry = slidingWindowStore.get(identifier) ?? { timestamps: [] };

  // Evict timestamps outside the sliding window
  entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0] ?? nowMs;
    const resetMs = Math.max(1000, oldestInWindow + windowMs - nowMs);
    const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
    slidingWindowStore.set(identifier, entry);

    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      retryAfterSeconds,
      headers: {
        'X-RateLimit-Limit': String(maxRequests),
        'X-RateLimit-Remaining': '0',
        'Retry-After': String(retryAfterSeconds),
      },
    };
  }

  entry.timestamps.push(nowMs);
  slidingWindowStore.set(identifier, entry);

  const remaining = Math.max(0, maxRequests - entry.timestamps.length);
  return {
    allowed: true,
    limit: maxRequests,
    remaining,
    retryAfterSeconds: 0,
    headers: {
      'X-RateLimit-Limit': String(maxRequests),
      'X-RateLimit-Remaining': String(remaining),
    },
  };
}

export function resetConciergeRateLimitStore(): void {
  slidingWindowStore.clear();
}

function resolveRequesterKey(request: NextRequest): string {
  const userId = request.headers.get('x-user-id')?.trim();
  if (userId) return `user:${userId}`;

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) return `ip:${forwardedFor}`;

  return 'ip:anonymous';
}

const SYSTEM_CONCIERGE_PROMPT =
  'You are the WorkSphere Workspace Concierge. Recommend quiet, high-Wi-Fi coworking cafes and spaces concisely based on user preferences.';

export async function POST(request: NextRequest) {
  // 1. Enforce sliding-window rate limiter before reading/forwarding LLM payloads
  const requesterKey = resolveRequesterKey(request);
  const rateLimit = checkConciergeSlidingWindowRateLimit(requesterKey);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded for AI venue concierge',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          ...rateLimit.headers,
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  }

  // 2. Reject oversized Content-Length headers immediately before buffering
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_CONCIERGE_BODY_BYTES) {
      return NextResponse.json(
        {
          error: `Request payload exceeds maximum allowed size of ${MAX_CONCIERGE_BODY_BYTES} bytes`,
        },
        {
          status: 413,
          headers: rateLimit.headers,
        }
      );
    }
  }

  // 3. Read raw text body with byte-length enforcement (defends against chunked/omitted Content-Length)
  let rawBodyText: string;
  try {
    rawBodyText = await request.text();
  } catch {
    return NextResponse.json(
      { error: 'Unable to read request body' },
      { status: 400, headers: rateLimit.headers }
    );
  }

  const actualByteLength = new TextEncoder().encode(rawBodyText).byteLength;
  if (actualByteLength > MAX_CONCIERGE_BODY_BYTES) {
    return NextResponse.json(
      {
        error: `Request payload exceeds maximum allowed size of ${MAX_CONCIERGE_BODY_BYTES} bytes`,
      },
      {
        status: 413,
        headers: rateLimit.headers,
      }
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBodyText);
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request payload' },
      { status: 400, headers: rateLimit.headers }
    );
  }

  // 4. Validate messages array (<= 20 items) and per-message length (<= 2000 chars) via Zod
  const validation = VenueConciergeRequestSchema.safeParse(parsedJson);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: 'Invalid venue concierge request payload',
        details: validation.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      {
        status: 400,
        headers: rateLimit.headers,
      }
    );
  }

  const { messages, venueContext } = validation.data;

  // 5. Forward strictly bounded conversation history to upstream LLM provider
  const upstreamMessages = [
    {
      role: 'system' as const,
      content: venueContext?.city
        ? `${SYSTEM_CONCIERGE_PROMPT} Active city context: ${venueContext.city}.`
        : SYSTEM_CONCIERGE_PROMPT,
    },
    ...messages,
  ];

  const apiKey = process.env.GROQ_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    return NextResponse.json(
      {
        reply: `Concierge ready (${messages.length} turns validated): "${lastUserMessage?.content.slice(0, 120) ?? ''}"`,
        messageCount: messages.length,
      },
      {
        status: 200,
        headers: rateLimit.headers,
      }
    );
  }

  try {
    const upstreamEndpoint = process.env.GROQ_API_KEY
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const model = process.env.GROQ_API_KEY
      ? 'llama-3.3-70b-versatile'
      : 'gpt-4o-mini';

    const upstreamRes = await fetch(upstreamEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: upstreamMessages,
        max_tokens: 512,
        temperature: 0.4,
      }),
    });

    if (!upstreamRes.ok) {
      return NextResponse.json(
        { error: 'Upstream AI concierge service temporarily unavailable' },
        {
          status: upstreamRes.status === 429 ? 429 : 502,
          headers: rateLimit.headers,
        }
      );
    }

    const completion = (await upstreamRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ??
      'No workspace recommendations available right now.';

    return NextResponse.json(
      {
        reply,
        messageCount: messages.length,
      },
      {
        status: 200,
        headers: rateLimit.headers,
      }
    );
  } catch (error: unknown) {
    console.error('[VenueConcierge] Upstream completion failure:', error);
    return NextResponse.json(
      { error: 'Failed to generate workspace recommendation' },
      {
        status: 502,
        headers: rateLimit.headers,
      }
    );
  }
}