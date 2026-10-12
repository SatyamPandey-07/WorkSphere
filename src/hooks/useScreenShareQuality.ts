/**
 * useScreenShareQuality.ts
 * React hook that monitors WebRTC stats for RTT and triggers quality adaptation.
 */

import { useState, useEffect, useRef } from 'react';
import { VideoQualityAdapter } from '@/lib/webrtc/VideoQualityAdapter';

export function useScreenShareQuality(sender: RTCRtpSender | null) {
    const [currentProfile, setCurrentProfile] = useState<string>('1080p');
    const adapterRef = useRef<VideoQualityAdapter | null>(null);
    const statsIntervalRef = useRef<number | null>(null);

    useEffect(() => {
        if (sender) {
            adapterRef.current = new VideoQualityAdapter(sender, currentProfile);
        }

        if (sender) {
            statsIntervalRef.current = window.setInterval(async () => {
                if (!adapterRef.current) return;

                const stats = await sender.getStats();
                let maxRtt = 0;

                stats.forEach((report) => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        if (report.currentRoundTripTime > maxRtt) {
                            maxRtt = report.currentRoundTripTime * 1000; // Convert to ms
                        }
                    }
                });

                if (maxRtt > 0) {
                    await adapterRef.current.adaptBasedOnRTT(maxRtt);
                    setCurrentProfile(adapterRef.current.getCurrentProfile());
                }
            }, 3000);
        }

        return () => {
            if (statsIntervalRef.current) {
                clearInterval(statsIntervalRef.current);
            }
        };
    }, [sender]);

    const manualSetProfile = async (profile: string) => {
        if (adapterRef.current) {
            await adapterRef.current.setProfile(profile);
            setCurrentProfile(profile);
        }
    };

    return { currentProfile, manualSetProfile };
}
