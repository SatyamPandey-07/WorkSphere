import { EventBus } from "@/lib/events/bus";
import { Redis } from "@upstash/redis";

jest.mock("@upstash/redis", () => {
  const mRedis = {
    lpush: jest.fn(),
    lmove: jest.fn(),
    lrem: jest.fn(),
    lrange: jest.fn(),
  };
  return {
    Redis: {
      fromEnv: () => mRedis,
    },
  };
});

describe("EventBus - Reliable Queueing", () => {
  let redisInstance: any;

  beforeEach(() => {
    redisInstance = Redis.fromEnv();
    jest.clearAllMocks();
  });

  it("should push event using lpush when emitting", async () => {
    await EventBus.emit({
      type: "booking:confirmed",
      userId: "user-1",
      data: { hello: "world" },
    });

    expect(redisInstance.lpush).toHaveBeenCalledWith(
      "work-sphere:webhook-events-queue",
      expect.stringContaining('"type":"booking:confirmed"'),
    );
  });

  it("should pop event using lmove", async () => {
    const mockEvent = {
      id: "e-1",
      type: "booking:confirmed",
      userId: "user-1",
      timestamp: new Date().toISOString(),
      data: {},
    };
    redisInstance.lmove.mockResolvedValue(JSON.stringify(mockEvent));

    const event = await EventBus.popEvent();
    expect(redisInstance.lmove).toHaveBeenCalledWith(
      "work-sphere:webhook-events-queue",
      "work-sphere:webhook-events-processing",
      "right",
      "left",
    );
    expect(event).toEqual(mockEvent);
  });

  it("should acknowledge event using lrem", async () => {
    const mockEvent = {
      id: "e-1",
      type: "booking:confirmed",
      userId: "user-1",
      timestamp: new Date().toISOString(),
      data: {},
    };

    await EventBus.ackEvent(mockEvent);
    expect(redisInstance.lrem).toHaveBeenCalledWith(
      "work-sphere:webhook-events-processing",
      1,
      JSON.stringify(mockEvent),
    );
  });

  it("should recover stale events and push them back", async () => {
    const staleEvent = {
      id: "e-stale",
      type: "booking:confirmed",
      userId: "user-1",
      timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago
      data: {},
    };
    const freshEvent = {
      id: "e-fresh",
      type: "booking:confirmed",
      userId: "user-1",
      timestamp: new Date().toISOString(), // fresh
      data: {},
    };

    redisInstance.lrange.mockResolvedValue([
      JSON.stringify(staleEvent),
      JSON.stringify(freshEvent),
    ]);

    await EventBus.recoverStaleEvents();

    expect(redisInstance.lrange).toHaveBeenCalledWith(
      "work-sphere:webhook-events-processing",
      0,
      -1,
    );
    expect(redisInstance.lpush).toHaveBeenCalledWith(
      "work-sphere:webhook-events-queue",
      JSON.stringify(staleEvent),
    );
    expect(redisInstance.lrem).toHaveBeenCalledWith(
      "work-sphere:webhook-events-processing",
      1,
      JSON.stringify(staleEvent),
    );
    // Fresh event shouldn't be touched
    expect(redisInstance.lpush).not.toHaveBeenCalledWith(
      "work-sphere:webhook-events-queue",
      JSON.stringify(freshEvent),
    );
  });
});
