/**
 * route.ts
 * Next.js API endpoint that streams the multi-agent debate process to the frontend via Server-Sent Events (SSE).
 */

import { NextRequest } from 'next/server';
import { DebateOrchestrator } from '@/core/agents/debate/DebateOrchestrator';
import { ConsensusResolver } from '@/core/agents/debate/ConsensusResolver';

export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            try {
                const body = await request.json();
                const { venueData, userPreferences } = body;

                if (!venueData || !venueData.id) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Invalid venue data' })}\n\n`));
                    controller.close();
                    return;
                }

                const orchestrator = new DebateOrchestrator(2);
                const resolver = new ConsensusResolver();

                // Stream initial status
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'starting', message: 'Initializing debate agents...' })}\n\n`));

                // Run debate and stream rounds
                const debateResult = await orchestrator.runDebate(venueData);

                for (const round of debateResult.rounds) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'round', data: round })}\n\n`));
                    // Small delay to simulate streaming thought process
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                // Resolve and stream final consensus
                const consensus = resolver.resolveConsensus(debateResult, userPreferences);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'complete', data: consensus })}\n\n`));

                controller.close();
            } catch (error) {
                console.error('Debate API error:', error);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Internal server error during debate' })}\n\n`));
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
