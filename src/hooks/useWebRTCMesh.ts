import { useState, useEffect, useRef } from 'react';
import { ScreenShareManager, StreamHealthTelemetry } from '@/lib/webrtc/screenShareManager';

export function useWebRTCMesh(peerConnection: RTCPeerConnection | null) {
  const [telemetry, setTelemetry] = useState<StreamHealthTelemetry>({
    bitrateBps: 2500000,
    framerate: 30,
    resolution: '1080p',
    rttMs: 45,
    packetLossPercent: 0.1,
  });

  const managerRef = useRef<ScreenShareManager | null>(null);

  useEffect(() => {
    if (!peerConnection) return;

    managerRef.current = new ScreenShareManager(peerConnection, (newTelemetry) => {
      setTelemetry(newTelemetry);
    });

    managerRef.current.startMonitoring();

    return () => {
      managerRef.current?.stopMonitoring();
    };
  }, [peerConnection]);

  return { telemetry };
}
