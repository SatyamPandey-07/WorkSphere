import {
  TelemetryWebSocketClient,
  WS_CLOSE_UNAUTHORIZED,
} from "@/lib/telemetry/wsClient";
import {
  recordConnectionClosed,
  recordConnectionDropped,
  recordConnectionOpened,
  recordReconnectAttempt,
  renderWsMetrics,
  resetWsMetrics,
  WS_ACTIVE_CONNECTIONS,
  WS_BACKOFF_DURATION_SECONDS,
  WS_CONNECTION_DROPS_TOTAL,
  WS_RECONNECT_ATTEMPTS_TOTAL,
} from "@/lib/telemetry/wsMetrics";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {}

  triggerOpen() {
    this.onopen?.(new Event("open"));
  }

  triggerClose(code = 1006, reason = "Abnormal closure") {
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

/** The value of one sample line, or undefined when the sample is absent. */
function sample(name: string, labels = ""): number | undefined {
  const line = renderWsMetrics()
    .split("\n")
    .find((entry) => entry.startsWith(`${name}${labels} `));
  return line === undefined ? undefined : Number(line.split(" ").pop());
}

const reconnects = (reason: string) =>
  sample(WS_RECONNECT_ATTEMPTS_TOTAL, `{reason="${reason}"}`);
const drops = (reason: string) =>
  sample(WS_CONNECTION_DROPS_TOTAL, `{reason="${reason}"}`);
const backoffBucket = (le: string) =>
  sample(`${WS_BACKOFF_DURATION_SECONDS}_bucket`, `{le="${le}"}`);

describe("telemetry WebSocket metrics registry", () => {
  beforeEach(() => resetWsMetrics());

  it("renders every metric with HELP and TYPE lines before any event", () => {
    const text = renderWsMetrics();

    expect(text).toContain(`# TYPE ${WS_ACTIVE_CONNECTIONS} gauge`);
    expect(text).toContain(`# TYPE ${WS_RECONNECT_ATTEMPTS_TOTAL} counter`);
    expect(text).toContain(`# TYPE ${WS_CONNECTION_DROPS_TOTAL} counter`);
    expect(text).toContain(`# TYPE ${WS_BACKOFF_DURATION_SECONDS} histogram`);
    expect(text.match(/^# HELP /gm)).toHaveLength(4);
    expect(text.endsWith("\n")).toBe(true);
    expect(sample(WS_ACTIVE_CONNECTIONS)).toBe(0);
    expect(backoffBucket("+Inf")).toBe(0);
    expect(sample(`${WS_BACKOFF_DURATION_SECONDS}_count`)).toBe(0);
  });

  it("only emits lines that follow the text exposition format", () => {
    recordConnectionOpened();
    recordConnectionDropped("connection_lost");
    recordReconnectAttempt("connection_lost", 1500);

    const sampleLine =
      /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[a-zA-Z_][a-zA-Z0-9_]*="[^"]*"\})? -?\d+(\.\d+)?$/;
    const lines = renderWsMetrics().trimEnd().split("\n");

    for (const line of lines) {
      if (line.startsWith("# ")) {
        expect(line).toMatch(/^# (HELP|TYPE) worksphere_telemetry_ws_\w+ .+$/);
      } else {
        expect(line).toMatch(sampleLine);
      }
    }
  });

  it("tracks the active connection gauge and never goes below zero", () => {
    recordConnectionOpened();
    recordConnectionOpened();
    expect(sample(WS_ACTIVE_CONNECTIONS)).toBe(2);

    recordConnectionClosed();
    recordConnectionClosed();
    recordConnectionClosed();
    expect(sample(WS_ACTIVE_CONNECTIONS)).toBe(0);
  });

  it("counts reconnect attempts and drops separately per reason", () => {
    recordReconnectAttempt("connection_lost", 1000);
    recordReconnectAttempt("connection_lost", 2000);
    recordReconnectAttempt("unauthorized");
    recordConnectionDropped("connect_failed");

    expect(reconnects("connection_lost")).toBe(2);
    expect(reconnects("unauthorized")).toBe(1);
    expect(reconnects("connect_failed")).toBeUndefined();
    expect(drops("connect_failed")).toBe(1);
  });

  it("fills cumulative histogram buckets from backoff delays", () => {
    recordReconnectAttempt("connection_lost", 500);
    recordReconnectAttempt("connection_lost", 3000);
    recordReconnectAttempt("connection_lost", 45_000);

    expect(backoffBucket("0.5")).toBe(1);
    expect(backoffBucket("2")).toBe(1);
    expect(backoffBucket("4")).toBe(2);
    expect(backoffBucket("30")).toBe(2);
    expect(backoffBucket("+Inf")).toBe(3);
    expect(sample(`${WS_BACKOFF_DURATION_SECONDS}_count`)).toBe(3);
    expect(sample(`${WS_BACKOFF_DURATION_SECONDS}_sum`)).toBeCloseTo(48.5);
  });

  it("leaves the histogram alone for a reconnect without a backoff", () => {
    recordReconnectAttempt("unauthorized");
    recordReconnectAttempt("connection_lost", Number.NaN);
    recordReconnectAttempt("connection_lost", -5);

    expect(sample(`${WS_BACKOFF_DURATION_SECONDS}_count`)).toBe(0);
    expect(reconnects("connection_lost")).toBe(2);
  });
});

describe("TelemetryWebSocketClient metrics", () => {
  const OriginalWebSocket = global.WebSocket;
  let client: TelemetryWebSocketClient;

  const latestSocket = () =>
    MockWebSocket.instances[MockWebSocket.instances.length - 1];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, "random").mockReturnValue(0);
    resetWsMetrics();
    MockWebSocket.instances = [];
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket;
    client = new TelemetryWebSocketClient({
      url: "wss://telemetry.test/socket",
      getToken: async () => "token",
      baseDelayMs: 1000,
    });
  });

  afterEach(() => {
    client.disconnect();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    (global as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      OriginalWebSocket;
  });

  it("counts a connection as active once it opens, not while connecting", async () => {
    await client.connect();
    expect(sample(WS_ACTIVE_CONNECTIONS)).toBe(0);

    latestSocket().triggerOpen();
    expect(sample(WS_ACTIVE_CONNECTIONS)).toBe(1);
  });

  it("records a drop, a reconnect attempt and its backoff when an open connection is lost", async () => {
    await client.connect();
    latestSocket().triggerOpen();

    latestSocket().triggerClose(1006);

    expect(sample(WS_ACTIVE_CONNECTIONS)).toBe(0);
    expect(drops("connection_lost")).toBe(1);
    expect(reconnects("connection_lost")).toBe(1);
    expect(backoffBucket("1")).toBe(1);
    expect(sample(`${WS_BACKOFF_DURATION_SECONDS}_sum`)).toBe(1);
  });

  it("restores the gauge after a successful reconnection", async () => {
    await client.connect();
    latestSocket().triggerOpen();
    latestSocket().triggerClose(1006);

    await jest.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    latestSocket().triggerOpen();

    expect(sample(WS_ACTIVE_CONNECTIONS)).toBe(1);
    expect(reconnects("connection_lost")).toBe(1);
  });

  it("labels a connection that never opened as connect_failed and grows the backoff", async () => {
    await client.connect();
    latestSocket().triggerClose(1006);
    await jest.advanceTimersByTimeAsync(1000);
    latestSocket().triggerClose(1006);

    expect(drops("connect_failed")).toBe(2);
    expect(reconnects("connect_failed")).toBe(2);
    expect(drops("connection_lost")).toBeUndefined();
    // Delays of 1s and 2s with jitter mocked to zero.
    expect(backoffBucket("1")).toBe(1);
    expect(backoffBucket("2")).toBe(2);
    expect(sample(`${WS_BACKOFF_DURATION_SECONDS}_sum`)).toBe(3);
  });

  it("stops counting reconnect attempts once the retry limit is reached", async () => {
    await client.connect();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      latestSocket().triggerClose(1006);
      await jest.advanceTimersByTimeAsync(30_000);
    }

    expect(drops("connect_failed")).toBe(6);
    expect(reconnects("connect_failed")).toBe(5);
  });

  it("counts an unauthorized close as a drop and an immediate reconnect with no backoff", async () => {
    await client.connect();
    latestSocket().triggerOpen();

    latestSocket().triggerClose(WS_CLOSE_UNAUTHORIZED, "unauthorized");
    await jest.advanceTimersByTimeAsync(0);

    expect(sample(WS_ACTIVE_CONNECTIONS)).toBe(0);
    expect(drops("unauthorized")).toBe(1);
    expect(reconnects("unauthorized")).toBe(1);
    expect(sample(`${WS_BACKOFF_DURATION_SECONDS}_count`)).toBe(0);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("does not count a manual disconnect as a drop", async () => {
    await client.connect();
    latestSocket().triggerOpen();

    client.disconnect();
    client.disconnect();

    expect(sample(WS_ACTIVE_CONNECTIONS)).toBe(0);
    expect(drops("connection_lost")).toBeUndefined();
    expect(reconnects("connection_lost")).toBeUndefined();
  });
});
