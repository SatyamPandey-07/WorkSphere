import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MedicalBeacon } from '@/core/network/MedicalBeacon';

const profileRegistrationSchema = z.object({
    userId: z.string().uuid(),
    bloodType: z.string(),
    severeAllergies: z.array(z.string()),
    chronicConditions: z.array(z.string()),
    emergencyContact: z.string(),
});

const networkPublicKey = process.env.MEDICAL_NETWORK_KEY || '0'.repeat(64);
const beaconGenerator = new MedicalBeacon(networkPublicKey);

export async function POST(req: NextRequest) {
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    try {
        if (path === 'register') {
            return await handleRegistration(req);
        } else if (path === 'verify') {
            return await handleVerification(req);
        }

        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    } catch (error: any) {
        console.error('Medical beacon API error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

async function handleRegistration(req: NextRequest) {
    const body = await req.json();
    const validation = profileRegistrationSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: 'Invalid payload', details: validation.error.flatten() }, { status: 400 });
    }

    const { userId, ...profileData } = validation.data;

    // In a real app, encrypt and store the profile securely
    const beacon = beaconGenerator.generateBeacon(userId, profileData);

    await saveEncryptedProfile(userId, beacon.encryptedProfile);

    return NextResponse.json({
        success: true,
        beaconId: beacon.id,
        message: 'Medical profile encrypted and registered for mesh broadcasting'
    }, { status: 201 });
}

async function handleVerification(req: NextRequest) {
    const body = await req.json();
    if (!body.beacon) {
        return NextResponse.json({ error: 'Beacon payload required' }, { status: 400 });
    }

    const isValid = beaconGenerator.verifyBeacon(body.beacon);

    if (!isValid) {
        return NextResponse.json({ valid: false, reason: 'Invalid signature or expired TTL' }, { status: 200 });
    }

    // Only certified devices should have the private key to decrypt
    return NextResponse.json({ valid: true }, { status: 200 });
}

async function saveEncryptedProfile(userId: string, encryptedProfile: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
}
