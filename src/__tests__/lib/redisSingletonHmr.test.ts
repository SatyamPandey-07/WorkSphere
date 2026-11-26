jest.mock("@upstash/redis", () => ({
  Redis: jest.fn().mockImplementation(() => {
    const state = globalThis as typeof globalThis & {
      __redisConstructorCalls?: number;
    };

    state.__redisConstructorCalls = (state.__redisConstructorCalls ?? 0) + 1;

    return { marker: "redis-client" };
  }),
}));

describe("Redis singleton during HMR", () => {
  const redisGlobal = globalThis as typeof globalThis & {
    __workSphereRedis?: unknown;
    __redisConstructorCalls?: number;
  };

  const originalNodeEnv = process.env.NODE_ENV;
  const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = "development";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    delete redisGlobal.__workSphereRedis;
    redisGlobal.__redisConstructorCalls = 0;
  });

  afterAll(() => {
    delete redisGlobal.__workSphereRedis;
    delete redisGlobal.__redisConstructorCalls;

    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    if (originalRedisUrl === undefined)
      delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalRedisUrl;

    if (originalRedisToken === undefined)
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalRedisToken;
  });

  it("reuses the same Redis client after module re-evaluation", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const firstClient = require("@/lib/redis").getRedis();

    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const secondClient = require("@/lib/redis").getRedis();

    expect(secondClient).toBe(firstClient);
    expect(redisGlobal.__redisConstructorCalls).toBe(1);
  });
});
