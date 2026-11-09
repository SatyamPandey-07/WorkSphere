/**
 * route.ts
 * Internal API endpoint for server-to-server mesh handshake and topology discovery.
 * Allows PartyKit instances to register themselves and exchange state deltas.
 */

import { NextRequest, NextResponse } from 'next/server';
import { globalRegionRouter } from '@/party/mesh/RegionRouter';

export interface MeshHandshakeRequest {
    nodeId: string;
    region: string;
    endpoint: string;
    latencyMs?: number;
}

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get('x-mesh-auth');
        if (authHeader !== process.env.MESH_SECRET_KEY) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body: MeshHandshakeRequest = await request.json();
        if (!body.nodeId || !body.region || !body.endpoint) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        globalRegionRouter.registerNode({
            id: body.nodeId,
            region: body.region,
            endpoint: body.endpoint,
            latencyMs: body.latencyMs || 0,
            lastSeen: Date.now(),
            isActive: true,
        });

        const topology = globalRegionRouter.getAllActiveNodes();
        return NextResponse.json({ success: true, topology }, { status: 200 });
    } catch (error) {
        console.error('Mesh handshake error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get('x-mesh-auth');
        if (authHeader !== process.env.MESH_SECRET_KEY) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        globalRegionRouter.checkStaleNodes();
        const topology = globalRegionRouter.getAllActiveNodes();
        return NextResponse.json({ success: true, topology }, { status: 200 });
    } catch (error) {
        console.error('Mesh topology fetch error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
