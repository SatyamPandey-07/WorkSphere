import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAbortError } from '@/lib/search/semanticSearchClient';

const SearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().positive().max(50_000).optional(),
  maxNoiseDb: z.number().min(20).max(120).optional(),
  amenities: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).default(15),
});

export async function POST(request: NextRequest) {
  try {
    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    const body = await request.json();
    const parsed = SearchRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid semantic search parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { query, latitude, longitude, radiusMeters, maxNoiseDb, amenities, limit } =
      parsed.data;

    // Pass request.signal to your hybrid/embedding search runner so client aborts
    // immediately cancel upstream Groq/OpenAI embedding API calls:
    // const results = await runHybridVenueSearch(
    //   { query, latitude, longitude, radiusMeters, maxNoiseDb, amenities, limit },
    //   { signal: request.signal }
    // );

    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    return NextResponse.json({
      query,
      results: [], // Replace with `results` from hybridSearch
      filters: { latitude, longitude, radiusMeters, maxNoiseDb, amenities, limit },
    });
  } catch (error: unknown) {
    if (isAbortError(error) || request.signal.aborted) {
      // Client disconnected / cancelled request; exit cleanly without 500 error logging
      return new NextResponse(null, { status: 499 });
    }

    console.error('[SemanticVenueSearch] Error:', error);
    return NextResponse.json(
      { error: 'Failed to execute semantic venue search' },
      { status: 500 }
    );
  }
}