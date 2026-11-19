export const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 2500;
export const DEFAULT_CHECKING_FALLBACK_MS = 5000;

export interface IceGatheringTelemetry {
  durationMs: number;
  host: number;
  srflx: number;
  relay: number;
  prflx: number;
  total: number;
  timedOut: boolean;
}

export interface IceGatheringOptions {
  /** Max time to wait for gathering to complete. Default 2500ms. */
  gatheringTimeoutMs?: number;
  /** Time in "checking" state before STUN/TURN fallback kicks in. Default 5000ms. */
  checkingFallbackMs?: number;
  /** Servers applied on fallback (should include TURN). */
  fallbackIceServers?: RTCIceServer[];
  onTelemetry?: (t: IceGatheringTelemetry) => void;
  logger?: Pick<Console, "info" | "warn">;
}

function candidateType(
  c: RTCIceCandidate,
): "host" | "srflx" | "relay" | "prflx" | null {
  const t =
    c.type ?? /\btyp (host|srflx|relay|prflx)\b/.exec(c.candidate ?? "")?.[1];
  return t === "host" || t === "srflx" || t === "relay" || t === "prflx"
    ? t
    : null;
}

/**
 * Resolves when ICE gathering completes OR the timeout elapses, whichever is first.
 * On timeout the caller proceeds with the candidates harvested so far
 * (pc.localDescription already contains them); later candidates can still trickle.
 */
export function waitForIceGathering(
  pc: RTCPeerConnection,
  opts: IceGatheringOptions = {},
): Promise<IceGatheringTelemetry> {
  const timeoutMs = opts.gatheringTimeoutMs ?? DEFAULT_ICE_GATHERING_TIMEOUT_MS;
  const log = opts.logger ?? console;
  const start = Date.now();
  const counts = { host: 0, srflx: 0, relay: 0, prflx: 0 };

  return new Promise((resolve) => {
    let done = false;

    const finish = (timedOut: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      pc.removeEventListener("icecandidate", onCandidate as EventListener);
      pc.removeEventListener("icegatheringstatechange", onState);

      const telemetry: IceGatheringTelemetry = {
        durationMs: Date.now() - start,
        ...counts,
        total: counts.host + counts.srflx + counts.relay + counts.prflx,
        timedOut,
      };
      log.info(
        `[ICE] gathering ${timedOut ? "timed out" : "complete"} in ${telemetry.durationMs}ms ` +
          `(host=${counts.host}, srflx=${counts.srflx}, relay=${counts.relay})`,
      );
      opts.onTelemetry?.(telemetry);
      resolve(telemetry);
    };

    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) return finish(false); // end-of-candidates
      const t = candidateType(e.candidate);
      if (t) counts[t]++;
    };
    const onState = () => {
      if (pc.iceGatheringState === "complete") finish(false);
    };

    const timer = setTimeout(() => finish(true), timeoutMs);
    pc.addEventListener("icecandidate", onCandidate as EventListener);
    pc.addEventListener("icegatheringstatechange", onState);
    if (pc.iceGatheringState === "complete") finish(false);
  });
}

/**
 * If the connection stays in "checking" too long, apply fallback STUN/TURN
 * servers and restart ICE. Returns a cancel function.
 */
export function startCheckingFallback(
  pc: RTCPeerConnection,
  opts: IceGatheringOptions = {},
): () => void {
  const delay = opts.checkingFallbackMs ?? DEFAULT_CHECKING_FALLBACK_MS;
  const log = opts.logger ?? console;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const onChange = () => {
    if (pc.iceConnectionState === "checking") {
      if (!timer) {
        timer = setTimeout(() => {
          timer = undefined;
          if (pc.iceConnectionState !== "checking") return;
          log.warn(
            '[ICE] still "checking" - applying STUN/TURN fallback and restarting ICE',
          );
          if (opts.fallbackIceServers?.length) {
            pc.setConfiguration({
              ...pc.getConfiguration(),
              iceServers: opts.fallbackIceServers,
            });
          }
          pc.restartIce();
        }, delay);
      }
    } else {
      clear(); // connected / completed / failed / closed
    }
  };

  pc.addEventListener("iceconnectionstatechange", onChange);
  onChange();

  return () => {
    clear();
    pc.removeEventListener("iceconnectionstatechange", onChange);
  };
}
