/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { POST } from '../../app/api/audio/jammer/route';

jest.mock('@clerk/nextjs/server', () => ({ auth: jest.fn() }));
jest.mock('@/lib/db', () => ({
    db: { privacyJammerSession: { create: jest.fn(), findMany: jest.fn() } },
}));

const mockedAuth = auth as unknown as jest.Mock;
const mockedCreate = db.privacyJammerSession.create as jest.Mock;

function makeRequest(body: unknown, raw = false) {
    return new NextRequest('http://localhost/api/audio/jammer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw ? (body as string) : JSON.stringify(body),
    });
}

const validPayload = { sessionDurationMin: 25, averageDelayMs: 42.5, venueId: 'venue_1' };

describe('POST /api/audio/jammer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedAuth.mockResolvedValue({ userId: 'user_123' });
    });

    it('saves a valid payload and returns 200', async () => {
        const res = await POST(makeRequest(validPayload));

        expect(res.status).toBe(200);
        expect(mockedCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                userId: 'user_123',
                venueId: 'venue_1',
                durationMinutes: 25,
                averageDelayMs: 42.5,
            }),
        });
    });

    it.each([
        ['non-numeric duration', { ...validPayload, sessionDurationMin: 'abc' }],
        ['negative duration', { ...validPayload, sessionDurationMin: -30 }],
        ['decimal duration', { ...validPayload, sessionDurationMin: 12.5 }],
        ['null delay', { ...validPayload, averageDelayMs: null }],
        ['negative delay', { ...validPayload, averageDelayMs: -5 }],
        ['missing venueId', { sessionDurationMin: 25, averageDelayMs: 42.5 }],
        ['whitespace-only venueId', { ...validPayload, venueId: '   ' }],
    ])('returns 400 for %s and does not save', async (_label, payload) => {
        const res = await POST(makeRequest(payload));

        expect(res.status).toBe(400);
        expect(mockedCreate).not.toHaveBeenCalled();
    });

    it('returns 400 for malformed JSON', async () => {
        const res = await POST(makeRequest('{not valid json', true));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
        expect(mockedCreate).not.toHaveBeenCalled();
    });

    it('returns 401 when the user is not signed in', async () => {
        mockedAuth.mockResolvedValue({ userId: null });

        const res = await POST(makeRequest(validPayload));

        expect(res.status).toBe(401);
        expect(mockedCreate).not.toHaveBeenCalled();
    });
});