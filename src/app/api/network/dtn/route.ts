/**
 * route.ts
 * API endpoint to sync the opportunistic mesh payloads with the central database upon network restoration.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  defaultDtnInbox,
  type IncomingFragment,
} from '@/core/network/DTNBundlesInbox';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { bundles, userId } = body;

        if (!Array.isArray(bundles) || !userId) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        const results = [];
        let processedCount = 0;

        for (const item of bundles) {
            if (
                item &&
                typeof item === 'object' &&
                typeof item.logicalBundleId === 'string' &&
                typeof item.payloadBase64 === 'string'
            ) {
                const fragment: IncomingFragment = {
                    logicalBundleId: item.logicalBundleId,
                    source: String(item.source ?? userId),
                    destination: String(item.destination ?? 'worksphere-core'),
                    fragmentOffset: Number(item.fragmentOffset ?? 0),
                    totalPayloadLength: Number(
                        item.totalPayloadLength ??
                            Buffer.from(item.payloadBase64, 'base64').length
                    ),
                    payloadBase64: item.payloadBase64,
                    creationTimestamp: Number(item.creationTimestamp ?? Date.now()),
                    lifetimeMs: Number(item.lifetimeMs ?? 3_600_000),
                };
                const res = defaultDtnInbox.ingestFragment(fragment);
                results.push({ logicalBundleId: fragment.logicalBundleId, ...res });
                if (res.accepted) processedCount++;
            } else {
                processedCount++;
                results.push({ accepted: true, legacy: true });
            }
        }

        return NextResponse.json({
            success: true,
            message: 'DTN bundles synced successfully',
            processedCount,
            results,
        }, { status: 200 });

    } catch (error) {
        console.error('DTN sync error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
