/**
 * route.ts
 * Next.js API endpoint exposing the itinerary optimizer to the frontend.
 * Validates input, constructs the graph, and returns the optimized sequence.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ItineraryGraph, VenueNode, TransitEdge } from '@/core/itinerary/ItineraryGraph';
import { TimeWindowConstraint } from '@/core/itinerary/TimeWindowConstraint';
import { TransitSolver } from '@/core/itinerary/TransitSolver';

export interface OptimizeRequestPayload {
  startVenueId: string;
  targetVenueIds: string[];
  venues: VenueNode[];
  edges: TransitEdge[];
  startTime: string; // ISO string
}

export async function POST(request: NextRequest) {
  try {
    const body: OptimizeRequestPayload = await request.json();

    if (!body.startVenueId || !Array.isArray(body.targetVenueIds) || !Array.isArray(body.venues)) {
      return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
    }

    const graph = new ItineraryGraph();
    const timeConstraint = new TimeWindowConstraint();

    // Populate graph and constraints
    for (const venue of body.venues) {
      graph.addNode(venue);
      timeConstraint.parseOpeningHours(venue.id, venue.openingHours);
    }

    for (const edge of body.edges) {
      graph.addEdge(edge);
    }

    const solver = new TransitSolver(graph, timeConstraint);
    const startTime = new Date(body.startTime);

    const solution = solver.optimize(body.startVenueId, body.targetVenueIds, startTime);

    return NextResponse.json({
      success: true,
      data: solution
    }, { status: 200 });

  } catch (error) {
    console.error('Itinerary optimization error:', error);
    return NextResponse.json({ 
      error: 'Internal server error during itinerary optimization',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}