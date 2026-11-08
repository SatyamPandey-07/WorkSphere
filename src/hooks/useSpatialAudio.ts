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
  const [remoteListeners, setRemoteListeners] = useState<string[]>([]);

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
      if (ctx.state !== "closed") {
        ctx.close().catch(() => {});
      }
      ctxRef.current = null;
      routerRef.current = null;
      interpolator.dispose();
      interpolatorRef.current = null;
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

  // Sync remote listener IDs from interpolator to state
  const syncRemoteListeners = useCallback(() => {
    const interpolator = interpolatorRef.current;
    if (!interpolator) return;
    setRemoteListeners((prev) => {
      const next = interpolator.getUserIds();
      if (prev.length === next.length && prev.every((id, i) => id === next[i])) {
        return prev;
      }
      return next;
    });
  }, []);

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

  // Sync remote listeners after every incoming message batch
  useEffect(() => {
    if (!isReady) return;
    const interval = setInterval(syncRemoteListeners, 1000);
    return () => clearInterval(interval);
  }, [isReady, syncRemoteListeners]);

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

  // ─── Procedural cockpit audio synthesis (no external audio files) ─────────

  /** Cached white-noise buffer (~1s mono). Generated once per context. */
  const noiseBufferRef = useRef<AudioBuffer | null>(null);

  const getNoiseBuffer = useCallback((ctx: BaseAudioContext): AudioBuffer => {
    if (noiseBufferRef.current) return noiseBufferRef.current;
    const length = Math.floor(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    noiseBufferRef.current = buffer;
    return buffer;
  }, []);

  /** Ensure context is running (autoplay policy) before scheduling any effect. */
  const ensureContextRunning = useCallback(async (): Promise<AudioContext | null> => {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        return null; // still blocked — no user gesture yet
      }
    }
    if (ctx.state !== "running") return null;
    return ctx;
  }, []);

  /** Register `onended` cleanup that disconnects every node in a chain. */
  const teardownOnEnd = useCallback(
    (source: AudioScheduledSourceNode, nodes: AudioNode[], duration: number) => {
      source.onended = () => {
        for (const node of nodes) {
          node.disconnect();
        }
      };
      // Safety net in case onended never fires (context suspended, etc.)
      window.setTimeout(() => {
        for (const node of nodes) {
          try {
            node.disconnect();
          } catch {
            /* already disconnected */
          }
        }
      }, duration * 1000 + 500);
    },
    [],
  );

  /**
   * Jet turbine sweep: two detuned sawtooth oscillators pitch-swept upward through
   * a lowpass filter sweep (BiquadFilterNode) with a slow gain envelope.
   */
  const playTurbineSweep = useCallback(
    async (durationMs = 1600, baseGain = 0.22) => {
      const ctx = await ensureContextRunning();
      if (!ctx) return;

      const t0 = ctx.currentTime;
      const duration = durationMs / 1000;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(baseGain, t0 + duration * 0.35);
      gain.gain.linearRampToValueAtTime(0, t0 + duration);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(320, t0);
      filter.frequency.exponentialRampToValueAtTime(4800, t0 + duration * 0.8);
      filter.frequency.exponentialRampToValueAtTime(800, t0 + duration);
      filter.Q.value = 4;

      const osc1 = ctx.createOscillator();
      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(60, t0);
      osc1.frequency.exponentialRampToValueAtTime(340, t0 + duration);

      const osc2 = ctx.createOscillator();
      osc2.type = "sawtooth";
      osc2.frequency.setValueAtTime(61.8, t0); // slight detune → turbine beating
      osc2.frequency.exponentialRampToValueAtTime(346, t0 + duration);

      // Thin noise bed spun up with the turbines
      const noise = ctx.createBufferSource();
      noise.buffer = getNoiseBuffer(ctx);
      noise.loop = true;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.002, t0);
      noiseGain.gain.linearRampToValueAtTime(0.04, t0 + duration * 0.5);
      noiseGain.gain.linearRampToValueAtTime(0, t0 + duration);

      osc1.connect(filter);
      osc2.connect(filter);
      noise.connect(noiseGain).connect(filter);
      filter.connect(gain).connect(ctx.destination);

      osc1.start(t0);
      osc2.start(t0);
      noise.start(t0);
      osc1.stop(t0 + duration);
      osc2.stop(t0 + duration);
      noise.stop(t0 + duration);

      teardownOnEnd(osc1, [gain, filter, osc1, osc2, noise, noiseGain], duration);
    },
    [ensureContextRunning, getNoiseBuffer, teardownOnEnd],
  );

  /**
   * Afterburner whoosh: band-passed white noise with a fast aggressive lowpass
   * and gain flare, plus a sub oscillator drop for ignition punch.
   */
  const playAfterburner = useCallback(
    async (durationMs = 1200, baseGain = 0.3) => {
      const ctx = await ensureContextRunning();
      if (!ctx) return;

      const t0 = ctx.currentTime;
      const duration = durationMs / 1000;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.exponentialRampToValueAtTime(baseGain, t0 + 0.08);
      gain.gain.exponentialRampToValueAtTime(baseGain * 0.4, t0 + duration * 0.6);
      gain.gain.linearRampToValueAtTime(0, t0 + duration);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(200, t0);
      filter.frequency.exponentialRampToValueAtTime(6500, t0 + 0.12);
      filter.frequency.exponentialRampToValueAtTime(900, t0 + duration);
      filter.Q.value = 1.2;

      const noise = ctx.createBufferSource();
      noise.buffer = getNoiseBuffer(ctx);
      noise.loop = true;

      const sub = ctx.createOscillator();
      sub.type = "triangle";
      sub.frequency.setValueAtTime(140, t0);
      sub.frequency.exponentialRampToValueAtTime(45, t0 + duration);
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(baseGain * 0.8, t0);
      subGain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

      noise.connect(filter).connect(gain);
      sub.connect(subGain).connect(gain);
      gain.connect(ctx.destination);

      noise.start(t0);
      sub.start(t0);
      noise.stop(t0 + duration);
      sub.stop(t0 + duration);

      teardownOnEnd(sub, [gain, filter, noise, sub, subGain], duration);
    },
    [ensureContextRunning, getNoiseBuffer, teardownOnEnd],
  );

  /**
   * Sonic boom chime resonance: low-frequency impulse decay — a pitch-bent
   * sub-bass oscillator pair with an exponential GainNode decay to zero,
   * layered with a short filtered noise crack at the impact point.
   */
  const playSonicBoom = useCallback(
    async (durationMs = 2200, baseGain = 0.4) => {
      const ctx = await ensureContextRunning();
      if (!ctx) return;

      const t0 = ctx.currentTime;
      const duration = durationMs / 1000;

      const boomGain = ctx.createGain();
      // Impulse attack then long exponential decay to zero
      boomGain.gain.setValueAtTime(0.0001, t0);
      boomGain.gain.exponentialRampToValueAtTime(baseGain, t0 + 0.03);
      boomGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      // Pitch-bent sub-bass oscillator pair (descending octave-ish bend)
      const sub1 = ctx.createOscillator();
      sub1.type = "sine";
      sub1.frequency.setValueAtTime(120, t0);
      sub1.frequency.exponentialRampToValueAtTime(28, t0 + duration * 0.9);

      const sub2 = ctx.createOscillator();
      sub2.type = "sine";
      sub2.frequency.setValueAtTime(122.4, t0);
      sub2.frequency.exponentialRampToValueAtTime(28.6, t0 + duration * 0.9);

      // Resonant chime overtone layered on top of the boom body
      const chime = ctx.createOscillator();
      chime.type = "sine";
      chime.frequency.setValueAtTime(720, t0);
      chime.frequency.exponentialRampToValueAtTime(690, t0 + duration * 0.5);
      const chimeGain = ctx.createGain();
      chimeGain.gain.setValueAtTime(baseGain * 0.25, t0);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration * 0.4);

      // Impact crack: short high-passed noise burst at t0
      const crack = ctx.createBufferSource();
      crack.buffer = getNoiseBuffer(ctx);
      const crackFilter = ctx.createBiquadFilter();
      crackFilter.type = "highpass";
      crackFilter.frequency.value = 1500;
      const crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(baseGain * 0.6, t0);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);

      sub1.connect(boomGain);
      sub2.connect(boomGain);
      chime.connect(chimeGain).connect(boomGain);
      crack.connect(crackFilter).connect(crackGain).connect(ctx.destination);
      boomGain.connect(ctx.destination);

      sub1.start(t0);
      sub2.start(t0);
      chime.start(t0);
      crack.start(t0);
      sub1.stop(t0 + duration);
      sub2.stop(t0 + duration);
      chime.stop(t0 + duration);
      crack.stop(t0 + 0.3);

      teardownOnEnd(
        sub1,
        [boomGain, sub1, sub2, chime, chimeGain, crack, crackFilter, crackGain],
        duration,
      );
    },
    [ensureContextRunning, getNoiseBuffer, teardownOnEnd],
  );

  return {
    isReady,
    contextState,
    remoteListeners,
    resumeAudioContext,
    attachRemoteTrack,
    detachPeer,
    setPeerVolume,
    updateLocalPosition,
    handleIncomingMessage,
    getRouter,
    // Procedural cockpit effects (pure Web Audio synthesis, zero file I/O)
    playTurbineSweep,
    playAfterburner,
    playSonicBoom,
  };
}
