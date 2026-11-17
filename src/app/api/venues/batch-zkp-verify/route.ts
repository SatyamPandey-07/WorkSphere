import { NextResponse } from 'next/server';
import { ZkNullifierVerifier } from '@/lib/crypto/zkNullifierVerifier';

const verifier = new ZkNullifierVerifier();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nullifiers, proof, publicSignals } = body;

    if (!Array.isArray(nullifiers) || nullifiers.length === 0) {
      return NextResponse.json({ error: 'Invalid or empty nullifiers array' }, { status: 400 });
    }

    const result = await verifier.verifyBatch(nullifiers, proof, publicSignals);

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Batch verification failed' }, { status: 500 });
  }
}