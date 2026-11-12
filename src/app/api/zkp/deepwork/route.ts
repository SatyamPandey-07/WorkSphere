import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { proof, publicInputs, commitment } = body;

        if (!proof || !publicInputs || !commitment) {
            return NextResponse.json({ error: 'Missing ZKP payload' }, { status: 400 });
        }

        // Server-side verification step (simulated)
        const isValid = proof.pi_a && proof.pi_b && proof.pi_c && proof.protocol === 'groth16';

        if (!isValid) {
            return NextResponse.json({ error: 'Proof verification failed' }, { status: 400 });
        }

        // Mint the verifiable credential to the user's ledger
        await db.deepWorkCredential.create({
            data: {
                userId,
                sessionId: publicInputs.sessionId,
                durationMinutes: publicInputs.durationMinutes,
                focusThreshold: publicInputs.focusThresholdPercentage,
                commitmentHash: commitment,
                proofData: JSON.stringify(proof),
                mintedAt: new Date()
            }
        });

        // Update user's lifetime deep work statistics
        await db.user.update({
            where: { id: userId },
            data: {
                totalDeepWorkMinutes: {
                    increment: publicInputs.durationMinutes
                }
            }
        });

        return NextResponse.json({
            success: true,
            message: 'Deep Work credential minted and verified successfully.',
            credentialId: publicInputs.sessionId
        }, { status: 200 });

    } catch (error: any) {
        console.error('[ZKP_DEEPWORK_API]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const sessionId = searchParams.get('sessionId');

        if (sessionId) {
            const credential = await db.deepWorkCredential.findUnique({
                where: { sessionId }
            });

            if (!credential) {
                return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
            }

            return NextResponse.json({ success: true, credential }, { status: 200 });
        }

        const credentials = await db.deepWorkCredential.findMany({
            where: { userId },
            orderBy: { mintedAt: 'desc' },
            take: 50
        });

        return NextResponse.json({
            success: true,
            credentials,
            totalSessions: credentials.length
        }, { status: 200 });

    } catch (error: any) {
        console.error('[ZKP_FETCH]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
