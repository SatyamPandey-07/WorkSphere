import { EventBus } from "../core/events";

describe("EventBus", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    // Clear listeners or reset singleton for isolation
    eventBus = (EventBus as any).getInstance();
    eventBus.clear();
  });

  afterEach(() => {
    eventBus.clear();
  });

  it("should successfully subscribe and receive an event", async () => {
    const handler = jest.fn();
    eventBus.on("booking:confirmed", handler);

    const payload = {
      bookingId: "b-123",
      confirmationId: "c-123",
      venue: { id: "v-1", name: "Test Venue", category: "workspace" },
      customerEmail: "test@example.com",
      date: "2024-01-01",
      time: "10:00"
    };

    await eventBus.emit("booking:confirmed", payload);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("should support multiple listeners for the same event", async () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    eventBus.on("booking:confirmed", handler1);
    eventBus.on("booking:confirmed", handler2);

    const payload = {
      bookingId: "b-456",
      confirmationId: "c-456",
      venue: { id: "v-2", name: "Another Venue", category: "cafe" },
      customerEmail: "test2@example.com",
      date: "2024-02-02",
      time: "14:00"
    };

    await eventBus.emit("booking:confirmed", payload);

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("should not call the handler after it is removed (off)", async () => {
    const handler = jest.fn();
    eventBus.on("booking:confirmed", handler);
    eventBus.off("booking:confirmed", handler);

    const payload = {
      bookingId: "b-789",
      confirmationId: "c-789",
      venue: { id: "v-3", name: "Test Venue 3", category: "studio" },
      customerEmail: "test3@example.com",
      date: "2024-03-03",
      time: "09:00"
    };

    await eventBus.emit("booking:confirmed", payload);

    expect(handler).not.toHaveBeenCalled();
  });

  it("should isolate failing handlers from other handlers", async () => {
    // Suppress console.error for this test
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const failingHandler = jest.fn(() => {
      throw new Error("I failed");
    });
    const successHandler = jest.fn();

    eventBus.on("booking:confirmed", failingHandler);
    eventBus.on("booking:confirmed", successHandler);

    const payload = {
      bookingId: "b-999",
      confirmationId: "c-999",
      venue: { id: "v-9", name: "Fail Venue", category: "workspace" },
      customerEmail: "fail@example.com",
      date: "2024-04-04",
      time: "11:00"
    };

    await eventBus.emit("booking:confirmed", payload);

    expect(failingHandler).toHaveBeenCalledTimes(1);
    expect(successHandler).toHaveBeenCalledTimes(1);
    
    consoleSpy.mockRestore();
  });
});
