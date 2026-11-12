import { useRef, useCallback } from "react";
import { MeshConnection } from "@/lib/webrtc/meshConnection";

export function useWebRTCMesh() {
  const meshRef = useRef<MeshConnection | null>(null);

  const getOrCreateConnection = useCallback((config?: RTCConfiguration) => {
    if (!meshRef.current) {
      meshRef.current = new MeshConnection(config);
    }
    return meshRef.current;
  }, []);

  const handleRemoteSignal = useCallback(
    async (signal: { type: "offer" | "answer" | "candidate"; data: any }) => {
      const conn = getOrCreateConnection();

      if (signal.type === "offer" || signal.type === "answer") {
        await conn.setRemoteDescription(signal.data);
      } else if (signal.type === "candidate") {
        await conn.addIceCandidate(signal.data);
      }
    },
    [getOrCreateConnection],
  );

  return { getOrCreateConnection, handleRemoteSignal };
}
