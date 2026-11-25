const mockCalculateWitness = jest.fn();
const mockGenerateProof = jest.fn();

jest.mock("snarkjs", () => ({
  wtns: { calculate: mockCalculateWitness },
  groth16: { prove: mockGenerateProof },
}));

jest.mock("@/lib/zkp/wasmSimd", () => ({
  getOptimizedZkpOptions: jest.fn(async () => ({
    witnessOptions: {},
    proverOptions: {},
    simdEnabled: false,
  })),
}));

describe("zkpWorker progress messages", () => {
  const originalSelf = globalThis.self;
  const handlers = new Map<string, EventListenerOrEventListenerObject>();
  const postedMessages: unknown[] = [];

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handlers.clear();
    postedMessages.length = 0;
    mockCalculateWitness.mockResolvedValue(undefined);
    mockGenerateProof.mockResolvedValue({
      proof: { pi_a: ["1"] },
      publicSignals: ["123"],
    });

    Object.defineProperty(globalThis, "self", {
      configurable: true,
      value: {
        addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => {
          handlers.set(type, handler);
        },
        postMessage: (message: unknown) => postedMessages.push(message),
        close: jest.fn(),
      },
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, "self", {
      configurable: true,
      value: originalSelf,
    });
  });

  it("reports actual witness, proving, and finalizing phase boundaries", async () => {
    await import("@/workers/zkpWorker");
    const messageHandler = handlers.get("message") as (
      event: MessageEvent,
    ) => Promise<void>;

    await messageHandler({
      data: {
        type: "prove",
        identityToken: "123",
        expectedCommit: "456",
      },
    } as MessageEvent);

    expect(postedMessages).toEqual([
      {
        type: "progress",
        stage: "generating",
        phase: "witness",
        percent: 0,
      },
      {
        type: "progress",
        stage: "generating",
        phase: "proving",
        percent: 50,
      },
      {
        type: "progress",
        stage: "generating",
        phase: "finalizing",
        percent: 90,
      },
      {
        type: "success",
        proof: { pi_a: ["1"] },
        publicSignals: ["123"],
      },
    ]);
  });
});
