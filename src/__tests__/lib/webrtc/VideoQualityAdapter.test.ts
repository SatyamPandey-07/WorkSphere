/**
 * VideoQualityAdapter.test.ts
 * Unit tests for the VideoQualityAdapter class.
 */

import { VideoQualityAdapter, QUALITY_PROFILES } from '@/lib/webrtc/VideoQualityAdapter';

describe('VideoQualityAdapter', () => {
    let mockSender: jest.Mocked<RTCRtpSender>;

    beforeEach(() => {
        mockSender = {
            getParameters: jest.fn().mockReturnValue({ encodings: [{}] }),
            setParameters: jest.fn().mockResolvedValue(undefined),
        } as unknown as jest.Mocked<RTCRtpSender>;
    });

    it('should initialize with default 1080p profile', () => {
        const adapter = new VideoQualityAdapter(mockSender);
        expect(adapter.getCurrentProfile()).toBe('1080p');
    });

    it('should set parameters correctly when profile changes', async () => {
        const adapter = new VideoQualityAdapter(mockSender);
        await adapter.setProfile('720p');

        expect(mockSender.setParameters).toHaveBeenCalledWith(
            expect.objectContaining({
                encodings: [
                    expect.objectContaining({
                        maxBitrate: QUALITY_PROFILES['720p'].maxBitrate,
                        minBitrate: QUALITY_PROFILES['720p'].minBitrate,
                        maxFramerate: QUALITY_PROFILES['720p'].maxFramerate,
                        scaleResolutionDownBy: QUALITY_PROFILES['720p'].scaleResolutionDownBy,
                    })
                ]
            })
        );
    });

    it('should downgrade profile when RTT is high', async () => {
        const adapter = new VideoQualityAdapter(mockSender, '1080p');
        await adapter.adaptBasedOnRTT(200); // > 150ms threshold

        expect(adapter.getCurrentProfile()).toBe('720p');
        expect(mockSender.setParameters).toHaveBeenCalled();
    });

    it('should upgrade profile when RTT improves', async () => {
        const adapter = new VideoQualityAdapter(mockSender, '480p');
        await adapter.adaptBasedOnRTT(50); // <= 150ms threshold

        expect(adapter.getCurrentProfile()).toBe('1080p');
        expect(mockSender.setParameters).toHaveBeenCalled();
    });
});
