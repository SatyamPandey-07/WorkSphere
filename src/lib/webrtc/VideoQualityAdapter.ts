/**
 * VideoQualityAdapter.ts
 * Manages WebRTC video track encoding bitrate adaptation based on receiver RTT 
 * and supports resolution capping for bandwidth-constrained participants.
 */

export interface QualityProfile {
    maxBitrate: number;
    minBitrate: number;
    maxFramerate: number;
    scaleResolutionDownBy: number;
}

export const QUALITY_PROFILES: Record<string, QualityProfile> = {
    '4k': { maxBitrate: 4000000, minBitrate: 2000000, maxFramerate: 30, scaleResolutionDownBy: 1 },
    '1080p': { maxBitrate: 2500000, minBitrate: 1000000, maxFramerate: 30, scaleResolutionDownBy: 1 },
    '720p': { maxBitrate: 1000000, minBitrate: 500000, maxFramerate: 30, scaleResolutionDownBy: 1.5 },
    '480p': { maxBitrate: 500000, minBitrate: 250000, maxFramerate: 20, scaleResolutionDownBy: 2 },
};

export class VideoQualityAdapter {
    private sender: RTCRtpSender | null;
    private currentProfile: string;
    private rttThreshold: number;

    constructor(sender: RTCRtpSender | null, initialProfile: string = '1080p') {
        this.sender = sender;
        this.currentProfile = initialProfile;
        this.rttThreshold = 150; // ms
    }

    public async setProfile(profileKey: string): Promise<void> {
        const profile = QUALITY_PROFILES[profileKey];
        if (!profile || !this.sender) return;

        this.currentProfile = profileKey;
        const parameters = this.sender.getParameters();

        if (!parameters.encodings) {
            parameters.encodings = [{}];
        }

        parameters.encodings[0].maxBitrate = profile.maxBitrate;
        parameters.encodings[0].minBitrate = profile.minBitrate;
        parameters.encodings[0].maxFramerate = profile.maxFramerate;
        parameters.encodings[0].scaleResolutionDownBy = profile.scaleResolutionDownBy;

        await this.sender.setParameters(parameters);
    }

    public async adaptBasedOnRTT(rtt: number): Promise<void> {
        if (!this.sender) return;

        if (rtt > this.rttThreshold && this.currentProfile !== '480p') {
            console.warn(`High RTT (${rtt}ms). Downgrading video quality.`);
            await this.setProfile('720p');
        } else if (rtt <= this.rttThreshold && this.currentProfile === '480p') {
            console.log(`RTT improved (${rtt}ms). Restoring video quality.`);
            await this.setProfile('1080p');
        }
    }

    public getCurrentProfile(): string {
        return this.currentProfile;
    }

    public setSender(sender: RTCRtpSender): void {
        this.sender = sender;
    }
}
