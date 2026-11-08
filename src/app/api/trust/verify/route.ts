/**
 * route.ts
 * API endpoint that verifies the ZKP on the server and updates the user's reputation ledger.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ReputationCircuit } from '@/core/zkp/ReputationCircuit';
import { reputationWasm } from '@/lib/wasm-loader/reputation';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, proof, publicSignals } = body;

        if (!userId || !proof || !publicSignals) {
            return NextResponse.json({ error: 'Missing required verification data.' }, { status: 400 });
        }

        // 1. Fetch the verification key (in production, load from secure storage or IPFS)
        const circuit = new ReputationCircuit();
        const paths = circuit.getArtifactPaths();

        // Mock vkey fetch
        const vkey = {
            protocol: 'groth16',
            curve: 'bn128',
            nPublic: 1,
            vk_alpha_1: [],
            vk_beta_2: [],
            vk_gamma_2: [],
            vk_delta_2: [],
            vk_alphabeta_12: []
        };

        // 2. Verify the proof on the server
        const isValid = await reputationWasm.verifyProof(vkey, publicSignals, proof);

        if (!isValid) {
            return NextResponse.json({ error: 'Invalid Zero-Knowledge Proof.' }, { status: 403 });
        }

        // 3. Update the user's reputation ledger (Mock)
        // await prisma.user.update({ where: { id: userId }, data: { isTrusted: true, trustScore: 100 } });

        return NextResponse.json({
            success: true,
            message: 'Trust verified successfully. Premium perks unlocked.',
            userId,
            trustStatus: 'VERIFIED'
        }, { status: 200 });

    } catch (error) {
        console.error('Trust verification API error:', error);
        return NextResponse.json({ error: 'Internal server error during ZKP verification.' }, { status: 500 });
    }
}
