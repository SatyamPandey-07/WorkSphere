/**
 * Tests for event-driven booking architecture.
 */

type EventName = "booking.created" | "booking.confirmed" | "booking.checked_in" | "booking.completed" | "booking.cancelled" | "payment.processed";

interface DomainEvent {
  eventId: string;
  eventName: EventName;
  aggregateId: string;    // bookingId
  payload: Record<string, unknown>;
  timestamp: number;
  version: number;
}

interface EventHandler {
  eventName: EventName;
  handler: (event: DomainEvent) => void;
  priority: number;
}

type HandlerRegistry = Map<EventName, EventHandler[]>;

function registerHandler(
  registry: HandlerRegistry,
  handler: EventHandler
): HandlerRegistry {
  const existing = registry.get(handler.eventName) ?? [];
  const updated = new Map(registry);
  updated.set(handler.eventName, [...existing, handler].sort((a, b) => a.priority - b.priority));
  return updated;
}

function dispatchEvent(
  event: DomainEvent,
  registry: HandlerRegistry
): number {
  const handlers = registry.get(event.eventName) ?? [];
  handlers.forEach((h) => h.handler(event));
  return handlers.length;
}

function eventHistory(events: DomainEvent[], aggregateId: string): DomainEvent[] {
  return events
    .filter((e) => e.aggregateId === aggregateId)
    .sort((a, b) => a.version - b.version);
}

function latestEventForAggregate(events: DomainEvent[], aggregateId: string): DomainEvent | null {
  const history = eventHistory(events, aggregateId);
  return history.length > 0 ? history[history.length - 1] : null;
}

const NOW = 1_700_000_000_000;
const EVENTS: DomainEvent[] = [
  { eventId: "e1", eventName: "booking.created",   aggregateId: "b1", payload: {}, timestamp: NOW - 3000, version: 1 },
  { eventId: "e2", eventName: "booking.confirmed",  aggregateId: "b1", payload: {}, timestamp: NOW - 2000, version: 2 },
  { eventId: "e3", eventName: "payment.processed",  aggregateId: "b1", payload: {}, timestamp: NOW - 1000, version: 3 },
  { eventId: "e4", eventName: "booking.created",    aggregateId: "b2", payload: {}, timestamp: NOW - 500,  version: 1 },
];

describe("Event-driven booking architecture", () => {
  it("eventHistory: b1 has 3 events in order", () => {
    const history = eventHistory(EVENTS, "b1");
    expect(history).toHaveLength(3);
    expect(history[0].version).toBe(1);
    expect(history[2].version).toBe(3);
  });

  it("latestEventForAggregate: b1 latest = payment.processed", () => {
    expect(latestEventForAggregate(EVENTS, "b1")!.eventName).toBe("payment.processed");
  });

  it("latestEventForAggregate: unknown aggregate → null", () => {
    expect(latestEventForAggregate(EVENTS, "b99")).toBeNull();
  });

  it("registerHandler: adds handler to registry", () => {
    const registry: HandlerRegistry = new Map();
    const handler: EventHandler = {
      eventName: "booking.created", priority: 1,
      handler: () => {},
    };
    const updated = registerHandler(registry, handler);
    expect(updated.get("booking.created")).toHaveLength(1);
  });

  it("dispatchEvent: returns count of handlers called", () => {
    let callCount = 0;
    const registry: HandlerRegistry = new Map();
    const h1: EventHandler = { eventName: "booking.created", priority: 1, handler: () => { callCount++; } };
    const h2: EventHandler = { eventName: "booking.created", priority: 2, handler: () => { callCount++; } };
    const reg1 = registerHandler(registry, h1);
    const reg2 = registerHandler(reg1, h2);
    const dispatched = dispatchEvent(EVENTS[0], reg2);
    expect(dispatched).toBe(2);
    expect(callCount).toBe(2);
  });
});
