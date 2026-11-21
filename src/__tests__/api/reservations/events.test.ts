import { NextRequest } from 'next/server';
import {
    GET,
    publishVenueReservationEvent,
} from '@/app/api/reservations/events/route';

describe('GET /api/reservations/events (SSE heartbeat cleanup)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test('returns 400 Bad Request when venueId query parameter is missing', async () => {
        const req = new NextRequest('http://localhost:3000/api/reservations/events');
        const res = await GET(req);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body).toEqual({ error: 'Missing required query parameter: venueId' });
    });

    test('clears heartbeat interval immediately when client calls reader.cancel() without aborting fetch signal', async () => {
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

        const req = new NextRequest(
            'http://localhost:3000/api/reservations/events?venueId=venue_123'
        );
        const res = await GET(req);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/event-stream');
        expect(res.body).not.toBeNull();

        const reader = res.body!.getReader();

        // Read initial 'connected' SSE frame
        const firstChunk = await reader.read();
        expect(firstChunk.done).toBe(false);
        const decoded = new TextDecoder().decode(firstChunk.value);
        expect(decoded).toContain('event: connected');
        expect(decoded).toContain('"venueId":"venue_123"');

        // Cancel stream directly via reader.cancel() without firing req.signal abort
        await reader.cancel('Client navigated away');

        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

        // Advance clock past multiple 15s heartbeat cycles (45s total) -> must not throw on closed controller
        expect(() => {
            jest.advanceTimersByTime(45_000);
        }).not.toThrow();

        // Publishing events after cancel must be a safe no-op
        expect(() => {
            publishVenueReservationEvent({
                type: 'availability_update',
                venueId: 'venue_123',
                availableSeats: 4,
                crowdLevel: 'QUIET',
                timestamp: new Date().toISOString(),
            });
        }).not.toThrow();

        clearIntervalSpy.mockRestore();
    });

    test('clears heartbeat interval when request.signal aborts', async () => {
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
        const abortController = new AbortController();

        const req = new NextRequest(
            'http://localhost:3000/api/reservations/events?venueId=venue_456',
            { signal: abortController.signal }
        );
        const res = await GET(req);
        expect(res.status).toBe(200);

        abortController.abort();

        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
        expect(() => {
            jest.advanceTimersByTime(30_000);
        }).not.toThrow();

        clearIntervalSpy.mockRestore();
    });
});