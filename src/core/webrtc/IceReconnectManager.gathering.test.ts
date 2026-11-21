import {
  waitForIceGathering,
  startCheckingFallback,
  DEFAULT_ICE_GATHERING_TIMEOUT_MS,
} from "./IceReconnectManager";

class FakePC extends EventTarget {
  iceGatheringState = "gathering";
  iceConnectionState = "new";
  restartIce = jest.fn();
  setConfiguration = jest.fn();
  getConfiguration = jest.fn(() => ({ iceServers: [] }));

  emitCandidate(type: string | null) {
    const ev = new Event("icecandidate") as any;
    ev.candidate = type
      ? { type, candidate: `candidate:1 1 udp 1 1.1.1.1 1 typ ${type}` }
      : null;
    this.dispatchEvent(ev);
  }
  setConn(state: string) {
    this.iceConnectionState = state;
    this.dispatchEvent(new Event("iceconnectionstatechange"));
  }
}

const quiet = { info: jest.fn(), warn: jest.fn() };

describe("waitForIceGathering", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("resolves on timeout with harvested candidates when STUN is slow", async () => {
    const pc = new FakePC();
    const onTelemetry = jest.fn();
    const p = waitForIceGathering(pc as any, { logger: quiet, onTelemetry });

    pc.emitCandidate("host");
    pc.emitCandidate("host");
    await jest.advanceTimersByTimeAsync(DEFAULT_ICE_GATHERING_TIMEOUT_MS);

    const t = await p;
    expect(t.timedOut).toBe(true);
    expect(t.host).toBe(2);
    expect(t.srflx).toBe(0);
    expect(t.durationMs).toBe(DEFAULT_ICE_GATHERING_TIMEOUT_MS);
    expect(onTelemetry).toHaveBeenCalledWith(t);
  });

  it("resolves early on end-of-candidates and counts each type", async () => {
    const pc = new FakePC();
    const p = waitForIceGathering(pc as any, { logger: quiet });
    pc.emitCandidate("host");
    pc.emitCandidate("srflx");
    pc.emitCandidate("relay");
    pc.emitCandidate(null);

    const t = await p;
    expect(t).toMatchObject({
      host: 1,
      srflx: 1,
      relay: 1,
      total: 3,
      timedOut: false,
    });
  });

  it("respects a custom timeout", async () => {
    const pc = new FakePC();
    const p = waitForIceGathering(pc as any, {
      gatheringTimeoutMs: 500,
      logger: quiet,
    });
    await jest.advanceTimersByTimeAsync(500);
    expect((await p).timedOut).toBe(true);
  });

  it("resolves immediately if gathering already complete", async () => {
    const pc = new FakePC();
    pc.iceGatheringState = "complete";
    expect(
      (await waitForIceGathering(pc as any, { logger: quiet })).timedOut,
    ).toBe(false);
  });
});

describe("startCheckingFallback", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const servers = [
    { urls: "turn:turn.example.com", username: "u", credential: "c" },
  ];

  it("applies fallback servers and restarts ICE if stuck in checking", () => {
    const pc = new FakePC();
    startCheckingFallback(pc as any, {
      checkingFallbackMs: 1000,
      fallbackIceServers: servers,
      logger: quiet,
    });
    pc.setConn("checking");
    jest.advanceTimersByTime(1000);

    expect(pc.setConfiguration).toHaveBeenCalledWith({ iceServers: servers });
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
  });

  it("does nothing if the connection succeeds in time", () => {
    const pc = new FakePC();
    startCheckingFallback(pc as any, {
      checkingFallbackMs: 1000,
      logger: quiet,
    });
    pc.setConn("checking");
    jest.advanceTimersByTime(500);
    pc.setConn("connected");
    jest.advanceTimersByTime(2000);

    expect(pc.restartIce).not.toHaveBeenCalled();
  });

  it("cancel function stops the fallback", () => {
    const pc = new FakePC();
    const cancel = startCheckingFallback(pc as any, {
      checkingFallbackMs: 1000,
      logger: quiet,
    });
    pc.setConn("checking");
    cancel();
    jest.advanceTimersByTime(2000);
    expect(pc.restartIce).not.toHaveBeenCalled();
  });
});
