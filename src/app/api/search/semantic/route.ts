/**
 * route.ts
 * API endpoint that orchestrates the tokenization, embedding, and vector similarity search pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { unicodeTokenizer } from '@/lib/wasm-loader/tokenizer';
import { SemanticEmbeddingGenerator } from '@/core/search/SemanticEmbeddingGenerator';
import { PgVectorQueryOptimizer, SearchFilters } from '@/core/search/PgVectorQueryOptimizer';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { query, filters, limit } = body as { query: string; filters?: SearchFilters; limit?: number };

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'Valid query string is required' }, { status: 400 });
        }

        // Sanitize and normalize excessive whitespace before tokenization (#5481)
        const sanitizedQuery = query.trim().replace(/\s+/g, ' ');
        if (sanitizedQuery.length === 0) {
            return NextResponse.json({ error: 'Valid query string is required' }, { status: 400 });
        }

        await unicodeTokenizer.initialize();
        const tokens = await unicodeTokenizer.tokenize(sanitizedQuery);
        const tokenizedQuery = tokens.join(' ');

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'Embedding API key not configured' }, { status: 500 });
        }

        const embeddingGenerator = new SemanticEmbeddingGenerator(apiKey);
        const queryVector = await embeddingGenerator.generateEmbedding(tokenizedQuery);

        const queryOptimizer = new PgVectorQueryOptimizer();
        const { sql, params } = queryOptimizer.buildQuery(queryVector, filters ?? {}, limit ?? 10);

        return NextResponse.json({
            success: true,
            tokenizedQuery,
            queryVectorLength: queryVector.length,
            generatedSql: sql,
            message: 'Semantic search pipeline executed successfully'
        }, { status: 200 });

    } catch (error) {
        console.error('Semantic search error:', error);
        return NextResponse.json({
            error: 'Internal server error during semantic search',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
