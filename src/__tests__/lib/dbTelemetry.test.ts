// Create shared mock functions/objects that are accessible outside/inside Jest mock
const mockHincrby = jest.fn();
const mockSadd = jest.fn();
const mockLpush = jest.fn();
const mockLtrim = jest.fn();
const mockLrange = jest.fn();
const mockExec = jest.fn();
const mockHgetall = jest.fn();
const mockSmembers = jest.fn();

const mockPipeline = {
  hincrby: mockHincrby,
  sadd: mockSadd,
  lpush: mockLpush,
  ltrim: mockLtrim,
  lrange: mockLrange,
  exec: mockExec,
};

const mockRedisInstance = {
  pipeline: jest.fn().mockReturnValue(mockPipeline),
  hgetall: mockHgetall,
  smembers: mockSmembers,
};

// Return chainable mock pipeline methods
mockHincrby.mockReturnValue(mockPipeline);
mockSadd.mockReturnValue(mockPipeline);
mockLpush.mockReturnValue(mockPipeline);
mockLtrim.mockReturnValue(mockPipeline);
mockLrange.mockReturnValue(mockPipeline);
mockExec.mockResolvedValue([]);

jest.mock("@upstash/redis", () => {
  return {
    Redis: jest.fn().mockImplementation(() => mockRedisInstance),
  };
});

describe("Database Telemetry", () => {
  const originalEnv = process.env;
  let dbTelemetry: typeof import("@/lib/dbTelemetry");

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    // Reset mock implementation/resolved values to default
    mockHincrby.mockReturnValue(mockPipeline);
    mockSadd.mockReturnValue(mockPipeline);
    mockLpush.mockReturnValue(mockPipeline);
    mockLtrim.mockReturnValue(mockPipeline);
    mockLrange.mockReturnValue(mockPipeline);
    mockExec.mockResolvedValue([]);
    mockHgetall.mockReset();
    mockSmembers.mockReset();

    // Reset module registry so each test gets a fresh cachedRedis and counters in dbTelemetry
    jest.resetModules();
    dbTelemetry = await import("@/lib/dbTelemetry");
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("In-Memory Fallback", () => {
    beforeEach(() => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    });

    it("should record query durations and calculate stats", async () => {
      dbTelemetry.recordQueryDuration("User", 150);
      dbTelemetry.recordQueryDuration("User", 250); // slow query

      const stats = await dbTelemetry.getDbLatencyStats();
      expect(stats.totalQueryCount).toBe(2);
      expect(stats.slowQueryCount).toBe(1);
      expect(stats.slowQueryThresholdMs).toBe(200);

      const userModel = stats.byModel.find((m) => m.model === "User");
      expect(userModel).toBeDefined();
      expect(userModel?.avgMs).toBe(200); // (150 + 250) / 2
      expect(userModel?.sampleCount).toBe(2);
    });
  });

  describe("Redis Integration", () => {
    beforeEach(() => {
      process.env.UPSTASH_REDIS_REST_URL = "https://mock-redis.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";
    });

    it("should write queries to Redis using a pipeline", async () => {
      dbTelemetry.recordQueryDuration("Product", 300);

      // Give async microtasks a tick to run
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRedisInstance.pipeline).toHaveBeenCalled();
      expect(mockHincrby).toHaveBeenCalledWith(
        "worksphere:telemetry:global",
        "totalQueryCount",
        1,
      );
      expect(mockHincrby).toHaveBeenCalledWith(
        "worksphere:telemetry:global",
        "slowQueryCount",
        1,
      );
      expect(mockSadd).toHaveBeenCalledWith(
        "worksphere:telemetry:models",
        "Product",
      );
      expect(mockLpush).toHaveBeenCalledWith(
        "worksphere:telemetry:samples:Product",
        expect.any(String),
      );
      expect(mockLtrim).toHaveBeenCalledWith(
        "worksphere:telemetry:samples:Product",
        0,
        199,
      );
      expect(mockExec).toHaveBeenCalled();
    });

    it("should fetch db stats from Redis", async () => {
      mockHgetall.mockResolvedValue({
        totalQueryCount: "10",
        slowQueryCount: "2",
      });
      mockSmembers.mockResolvedValue(["Product"]);
      mockExec.mockResolvedValue([
        [
          JSON.stringify({ durationMs: 100, timestamp: Date.now() }),
          JSON.stringify({ durationMs: 300, timestamp: Date.now() }),
        ],
      ]);

      const stats = await dbTelemetry.getDbLatencyStats();

      expect(mockHgetall).toHaveBeenCalledWith(
        "worksphere:telemetry:global",
        expect.any(Object),
      );
      expect(mockSmembers).toHaveBeenCalledWith(
        "worksphere:telemetry:models",
        expect.any(Object),
      );
      expect(mockLrange).toHaveBeenCalledWith(
        "worksphere:telemetry:samples:Product",
        0,
        -1,
      );

      expect(stats.totalQueryCount).toBe(10);
      expect(stats.slowQueryCount).toBe(2);
      expect(stats.avgMs).toBe(200);
      expect(stats.p95Ms).toBe(300);
      expect(stats.byModel).toContainEqual({
        model: "Product",
        avgMs: 200,
        p95Ms: 300,
        sampleCount: 2,
      });
    });

    it("should fetch db stats from Redis when it yields pre-deserialized objects (production behavior)", async () => {
      mockHgetall.mockResolvedValue({
        totalQueryCount: "5",
        slowQueryCount: "1",
      });
      mockSmembers.mockResolvedValue(["Product"]);
      // Return objects directly (automatic deserialization behavior)
      mockExec.mockResolvedValue([
        [
          { durationMs: 120, timestamp: Date.now() },
          { durationMs: 220, timestamp: Date.now() },
        ],
      ]);

      const stats = await dbTelemetry.getDbLatencyStats();

      expect(stats.totalQueryCount).toBe(5);
      expect(stats.slowQueryCount).toBe(1);
      expect(stats.avgMs).toBe(170);
      expect(stats.p95Ms).toBe(220);
      expect(stats.byModel).toContainEqual({
        model: "Product",
        avgMs: 170,
        p95Ms: 220,
        sampleCount: 2,
      });
    });
  });
});
