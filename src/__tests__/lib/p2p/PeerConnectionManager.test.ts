/**
 * PeerConnectionManager.test.ts
 * Unit tests for the PeerConnectionManager to ensure proper lifecycle cleanup.
 */

import { PeerConnectionManager } from '@/lib/p2p/PeerConnectionManager';

// Mock RTCPeerConnection
jest.mock('RTCPeerConnection', () => {
    return jest.fn().mockImplementation(() => ({
        connectionState: 'new',
        iceConnectionState: 'new',
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    }));
});

describe('PeerConnectionManager', () => {
    let manager: PeerConnectionManager;

    beforeEach(() => {
        jest.useFakeTimers();
        manager = new PeerConnectionManager({
            peerId: 'test-peer-1',
            heartbeatIntervalMs: 1000,
            missedHeartbeatThreshold: 2,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        manager.tearDown();
    });

    it('should initialize in "new" state', () => {
        expect(manager.state).toBe('new');
    });

    it('should tear down after missing heartbeat threshold', () => {
        const tearDownSpy = jest.spyOn(manager, 'tearDown');

        // Advance time past the threshold (1000ms * 2 = 2000ms)
        jest.advanceTimersByTime(2500);

        expect(tearDownSpy).toHaveBeenCalled();
        expect(manager.state).toBe('closed');
    });

    it('should reset heartbeat timer when recordHeartbeat is called', () => {
        const tearDownSpy = jest.spyOn(manager, 'tearDown');

        // Advance time to just before threshold
        jest.advanceTimersByTime(1500);
        manager.recordHeartbeat();

        // Advance time again
        jest.advanceTimersByTime(1500);

        // Should not have torn down because heartbeat was reset
        expect(tearDownSpy).not.toHaveBeenCalled();
    });

    it('should clean up resources on tearDown', () => {
        const closeSpy = jest.spyOn(manager.connection, 'close');
        manager.tearDown();

        expect(closeSpy).toHaveBeenCalled();
        expect(manager.state).toBe('closed');
    });
});
