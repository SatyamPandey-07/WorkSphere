import {
    WebRTCMesh,
    WebRTCSignalingPayload,
    isPolitePeer,
} from '@/core/network/WebRTCMesh';

class MockRTCPeerConnection {
    public signalingState: RTCSignalingState = 'stable';
    public iceConnectionState: RTCIceConnectionState = 'connected';
    public connectionState: RTCPeerConnectionState = 'connected';
    public localDescription: RTCSessionDescriptionInit | null = null;
    public remoteDescription: RTCSessionDescriptionInit | null = null;

    public onnegotiationneeded: (() => void) | null = null;
    public onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
    public ondatachannel: ((e: { channel: RTCDataChannel }) => void) | null = null;
    public oniceconnectionstatechange: (() => void) | null = null;
    public onconnectionstatechange: (() => void) | null = null;

    public restartIce = jest.fn();
    public addIceCandidate = jest.fn().mockResolvedValue(undefined);
    public close = jest.fn();

    public createDataChannel = jest.fn().mockReturnValue({
        readyState: 'open',
        close: jest.fn(),
        send: jest.fn(),
    });

    public createOffer = jest
        .fn()
        .mockImplementation(async (opts?: RTCOfferOptions) => ({
            type: 'offer' as const,
            sdp: opts?.iceRestart ? 'v=0\r\nmock-ice-restart-offer' : 'v=0\r\nmock-offer',
        }));

    public setLocalDescription = jest
        .fn()
        .mockImplementation(async (desc?: RTCSessionDescriptionInit) => {
            if (desc?.type === 'rollback') {
                this.localDescription = null;
                this.signalingState = 'stable';
                return;
            }

            if (desc) {
                this.localDescription = desc;
            } else if (this.signalingState === 'have-remote-offer') {
                this.localDescription = { type: 'answer', sdp: 'v=0\r\nmock-answer' };
            } else {
                this.localDescription = { type: 'offer', sdp: 'v=0\r\nmock-offer' };
            }

            if (this.localDescription.type === 'offer') {
                this.signalingState = 'have-local-offer';
            } else if (this.localDescription.type === 'answer') {
                this.signalingState = 'stable';
            }
        });

    public setRemoteDescription = jest
        .fn()
        .mockImplementation(async (desc: RTCSessionDescriptionInit) => {
            this.remoteDescription = desc;
            if (desc.type === 'offer') {
                this.signalingState = 'have-remote-offer';
            } else if (desc.type === 'answer') {
                this.signalingState = 'stable';
            }
        });
}

describe('WebRTCMesh (W3C Perfect Negotiation Glare Rollback)', () => {
    const originalRTCPeerConnection = global.RTCPeerConnection;

    beforeEach(() => {
        (global as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
            MockRTCPeerConnection;
    });

    afterEach(() => {
        (global as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
            originalRTCPeerConnection;
        jest.restoreAllMocks();
    });

    test('assigns deterministic polite and impolite roles', () => {
        expect(isPolitePeer('peer-alpha', 'peer-zeta')).toBe(true);
        expect(isPolitePeer('peer-zeta', 'peer-alpha')).toBe(false);
    });

    test('resolves simultaneous ICE restart glare via polite rollback and impolite ignore without DataChannel deadlock', async () => {
        const politeSignals: WebRTCSignalingPayload[] = [];
        const impoliteSignals: WebRTCSignalingPayload[] = [];

        const politeMesh = new WebRTCMesh('peer-alpha', {
            onSendSignal: (sig) => {
                politeSignals.push(sig);
            },
        });

        const impoliteMesh = new WebRTCMesh('peer-zeta', {
            onSendSignal: (sig) => {
                impoliteSignals.push(sig);
            },
        });

        // Both peers simultaneously lose cafe Wi-Fi and initiate an ICE restart offer
        await Promise.all([
            politeMesh.restartIce('peer-zeta'),
            impoliteMesh.restartIce('peer-alpha'),
        ]);

        const politeSession = politeMesh.getPeerSession('peer-zeta')!;
        const impoliteSession = impoliteMesh.getPeerSession('peer-alpha')!;

        expect(politeSession.pc.signalingState).toBe('have-local-offer');
        expect(impoliteSession.pc.signalingState).toBe('have-local-offer');

        const politeOffer = politeSignals.find((s) => s.description?.type === 'offer')!;
        const impoliteOffer = impoliteSignals.find((s) => s.description?.type === 'offer')!;

        // 1. Impolite peer receives colliding offer -> ignores it and keeps its own pending offer
        await impoliteMesh.handleSignal(politeOffer);
        expect(impoliteSession.ignoreOffer).toBe(true);
        expect(impoliteSession.pc.setLocalDescription).not.toHaveBeenCalledWith({
            type: 'rollback',
        });
        expect(impoliteSession.pc.signalingState).toBe('have-local-offer');

        // 2. Polite peer receives colliding offer -> executes rollback + setRemoteDescription and emits answer
        await politeMesh.handleSignal(impoliteOffer);
        expect(politeSession.pc.setLocalDescription).toHaveBeenCalledWith({
            type: 'rollback',
        });
        expect(politeSession.pc.setRemoteDescription).toHaveBeenCalledWith(
            impoliteOffer.description
        );
        expect(politeSession.pc.signalingState).toBe('stable');

        const politeAnswer = politeSignals.find((s) => s.description?.type === 'answer')!;
        expect(politeAnswer).toBeDefined();

        // 3. Impolite peer applies polite peer's answer -> both peers converge to 'stable'
        await impoliteMesh.handleSignal(politeAnswer);
        expect(impoliteSession.pc.signalingState).toBe('stable');
        expect(politeSession.pc.signalingState).toBe('stable');

        politeMesh.destroy();
        impoliteMesh.destroy();
    });
});