"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SpatialAudioRouter,
  type PeerSpatialChain,
} from "@/lib/spatial/SpatialAudioRouter";
import {
  RemoteListenerInterpolator,
  type SpatialListenerUpdate,
  type Vector3D,
} from "@/lib/spatial/RemoteListenerInterpolator";

export interface UseSpatialAudioOptions {
  roomId: string;
  userId: string;
  localPosition?: Vector3D;
  localForward?: Vector3D;
  localUp?: Vector3D;
  peerPositions?: Map<string, Vector3D>;
  socket?:
    WebSocket | { send: (data: string) => void; readyState: number } | null;
  broadcastIntervalMs?: number;
}

export function useSpatialAudio({
  roomId: _roomId,
  userId,
  localPosition = { x: 0, y: 0, z: 0 },
  localForward = { x: 0, y: 0, z: 1 },
  localUp = { x: 0, y: 1, z: 0 },
  peerPositions,
  socket,
  broadcastIntervalMs = 50,
}: UseSpatialAudioOptions) {
  const [isReady, setIsReady] = useState(false);
  const [contextState, setContextState] =
    useState<AudioContextState>("suspended");

  const routerRef = useRef<SpatialAudioRouter | null>(null);
  const interpolatorRef = useRef<RemoteListenerInterpolator | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  // 1. Initialize AudioContext and SpatialAudioRouter
  useEffect(() => {
    if (typeof window === "undefined") return;

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    ctxRef.current = ctx;

    const router = new SpatialAudioRouter(ctx);
    const interpolator = new RemoteListenerInterpolator();

    routerRef.current = router;
    interpolatorRef.current = interpolator;

    setContextState(ctx.state);
    setIsReady(true);

    const handleStateChange = () => {
      setContextState(ctx.state);
    };
    ctx.addEventListener("statechange", handleStateChange);

    return () => {
      ctx.removeEventListener("statechange", handleStateChange);
      router.detachAll();
      ctx.close().catch(() => {});
      interpolator.dispose();
      setIsReady(false);
    };
  }, []);

  // Resume AudioContext on user gesture if suspended
  const resumeAudioContext = useCallback(async () => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state === "suspended") {
      await ctx.resume();
      setContextState(ctx.state);
    }
  }, []);

  // 2. Sync local AudioListener position and orientation
  useEffect(() => {
    const router = routerRef.current;
    if (!router || !isReady) return;

    router.updateListenerPosition(
      localPosition.x,
      localPosition.y,
      localPosition.z,
    );
    router.updateListenerOrientation(
      localForward.x,
      localForward.y,
      localForward.z,
      localUp.x,
      localUp.y,
      localUp.z,
    );
  }, [localPosition, localForward, localUp, isReady]);

  // 3. Sync remote peer positions from peerPositions map
  useEffect(() => {
    const router = routerRef.current;
    if (!router || !isReady || !peerPositions) return;

    for (const [peerId, pos] of peerPositions.entries()) {
      router.updatePeerPosition(peerId, pos.x, pos.y, pos.z);
    }
  }, [peerPositions, isReady]);

  // 4. Handle incoming spatial listener update messages
  const handleIncomingMessage = useCallback((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const msg = data as Partial<SpatialListenerUpdate>;

    if (
      msg.type === "spatial_listener_update" &&
      msg.userId &&
      msg.position &&
      msg.forward
    ) {
      const update: SpatialListenerUpdate = {
        type: "spatial_listener_update",
        userId: msg.userId,
        position: msg.position,
        forward: msg.forward,
        up: msg.up ?? { x: 0, y: 1, z: 0 },
        timestamp: msg.timestamp ?? performance.now(),
      };

      const router = routerRef.current;
      const interpolator = interpolatorRef.current;
      if (router && interpolator) {
        interpolator.applyUpdate(update, router);
      }
    }
  }, []);

  // 5. Broadcast local listener coordinates to PartySocket at 20 Hz
  useEffect(() => {
    if (!socket || !isReady || !userId) return;

    const timer = setInterval(() => {
      const readyState = "readyState" in socket ? socket.readyState : 1;
      if (readyState !== 1) return; // 1 = OPEN

      const message: SpatialListenerUpdate = {
        type: "spatial_listener_update",
        userId,
        position: localPosition,
        forward: localForward,
        up: localUp,
        timestamp: performance.now(),
      };

      try {
        socket.send(JSON.stringify(message));
      } catch (err) {
        console.error("[SpatialAudio] Broadcast failed:", err);
      }
    }, broadcastIntervalMs);

    return () => clearInterval(timer);
  }, [
    socket,
    userId,
    localPosition,
    localForward,
    localUp,
    isReady,
    broadcastIntervalMs,
  ]);

  const attachRemoteTrack = useCallback(
    (peerId: string, stream: MediaStream): PeerSpatialChain | undefined => {
      resumeAudioContext();
      return routerRef.current?.attachRemoteTrack(peerId, stream);
    },
    [resumeAudioContext],
  );

  const detachPeer = useCallback((peerId: string) => {
    routerRef.current?.detachPeer(peerId);
    interpolatorRef.current?.clearUser(peerId);
  }, []);

  const setPeerVolume = useCallback((peerId: string, volume: number) => {
    routerRef.current?.setPeerVolume(peerId, volume);
  }, []);

  const updateLocalPosition = useCallback(
    (pos: Vector3D, forward?: Vector3D, up?: Vector3D) => {
      const router = routerRef.current;
      if (!router) return;

      router.updateListenerPosition(pos.x, pos.y, pos.z);
      if (forward && up) {
        router.updateListenerOrientation(
          forward.x,
          forward.y,
          forward.z,
          up.x,
          up.y,
          up.z,
        );
      }
    },
    [],
  );

  const getRouter = useCallback(() => routerRef.current, []);

  return {
    isReady,
    contextState,
    resumeAudioContext,
    attachRemoteTrack,
    detachPeer,
    setPeerVolume,
    updateLocalPosition,
    handleIncomingMessage,
    getRouter,
  };
}
