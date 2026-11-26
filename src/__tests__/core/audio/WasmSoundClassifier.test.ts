import { WasmSoundClassifier } from '@/core/audio/WasmSoundClassifier';

describe('WasmSoundClassifier (AudioWorklet & WASM Ring Buffer Cleanup)', () => {
    const originalAudioContext = window.AudioContext;
    const originalAudioWorkletNode = (global as unknown as { AudioWorkletNode?: unknown })
        .AudioWorkletNode;
    const originalMediaDevices = navigator.mediaDevices;

    afterEach(() => {
        window.AudioContext = originalAudioContext;
        (global as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode =
            originalAudioWorkletNode;
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: originalMediaDevices,
        });
        jest.restoreAllMocks();
    });

    test('stops all MediaStream audio tracks, disconnects AudioWorkletNode, frees WASM ring buffer, and closes AudioContext on dispose', async () => {
        const callOrder: string[] = [];

        const mockTrack1 = { stop: jest.fn(() => callOrder.push('track1.stop')) };
        const mockTrack2 = { stop: jest.fn(() => callOrder.push('track2.stop')) };
        const mockMediaStream = {
            getTracks: jest.fn(() => [mockTrack1, mockTrack2]),
        } as unknown as MediaStream;

        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                getUserMedia: jest.fn().mockResolvedValue(mockMediaStream),
            },
        });

        const mockSourceNode = {
            connect: jest.fn(),
            disconnect: jest.fn(() => callOrder.push('source.disconnect')),
        };

        const mockAudioContext = {
            state: 'running' as AudioContextState,
            resume: jest.fn().mockResolvedValue(undefined),
            suspend: jest.fn(() => {
                throw new Error('AudioContext must be closed, not suspended');
            }),
            close: jest.fn(async () => {
                mockAudioContext.state = 'closed';
                callOrder.push('audioContext.close');
            }),
            audioWorklet: {
                addModule: jest.fn().mockResolvedValue(undefined),
            },
            createMediaStreamSource: jest.fn(() => mockSourceNode),
        };

        window.AudioContext = jest.fn(() => mockAudioContext) as unknown as typeof AudioContext;

        const mockWorkletPort = {
            onmessage: null as ((e: MessageEvent) => void) | null,
            close: jest.fn(),
        };
        const mockWorkletNode = {
            port: mockWorkletPort,
            disconnect: jest.fn(() => callOrder.push('worklet.disconnect')),
        };

        (global as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = jest.fn(
            () => mockWorkletNode
        );

        const allocSpy = jest.fn(() => 0x10000);
        const deallocSpy = jest.fn((ptr: number) => {
            callOrder.push(`wasm.dealloc_ring_buffer(${ptr})`);
        });

        const mockWasmInstance = {
            exports: {
                memory: new WebAssembly.Memory({ initial: 256 }),
                alloc_ring_buffer: allocSpy,
                dealloc_ring_buffer: deallocSpy,
            },
        } as unknown as WebAssembly.Instance;

        const classifier = new WasmSoundClassifier({
            ringBufferBytes: 16 * 1024 * 1024,
            instantiateWasmFn: async () => mockWasmInstance,
        });

        await classifier.start();

        expect(classifier.active).toBe(true);
        expect(allocSpy).toHaveBeenCalledWith(16 * 1024 * 1024);
        expect(classifier.allocatedPointer).toBe(0x10000);

        // Trigger unmount / cleanup
        await classifier.dispose();

        expect(classifier.active).toBe(false);
        expect(classifier.allocatedPointer).toBeNull();
        expect(mockTrack1.stop).toHaveBeenCalledTimes(1);
        expect(mockTrack2.stop).toHaveBeenCalledTimes(1);
        expect(mockWorkletNode.disconnect).toHaveBeenCalledTimes(1);
        expect(mockSourceNode.disconnect).toHaveBeenCalledTimes(1);
        expect(deallocSpy).toHaveBeenCalledWith(0x10000, 16 * 1024 * 1024);
        expect(mockAudioContext.close).toHaveBeenCalledTimes(1);
        expect(mockAudioContext.suspend).not.toHaveBeenCalled();

        expect(callOrder).toEqual([
            'track1.stop',
            'track2.stop',
            'worklet.disconnect',
            'source.disconnect',
            'wasm.dealloc_ring_buffer(65536)',
            'audioContext.close',
        ]);

        // Second dispose() call is safely idempotent (does not double-free WASM pointer)
        await classifier.dispose();
        expect(deallocSpy).toHaveBeenCalledTimes(1);
        expect(mockAudioContext.close).toHaveBeenCalledTimes(1);
    });
});