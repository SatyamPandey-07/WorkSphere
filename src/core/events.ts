/**
 * Centralized Event Bus for decoupled architecture.
 */

// Define all system events and their corresponding payload types here
export interface AppEvents {
  "booking:confirmed": {
    bookingId: string;
    confirmationId: string;
    venue: { id: string; name: string; category: string; address?: string };
    customerEmail: string;
    date: string;
    time: string;
  };
  // Add more events as needed
  "user:created": { userId: string; email: string };
  "checkin:confirmed": {
    userId: string;
    userName: string;
    venue: {
      id: string;
      name: string;
      category: string;
      address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    };
  };
  "session:rsvp": {
    sessionId: string;
    rsvpId: string;
    userId: string;
    status: string;
  };
}

export type EventName = keyof AppEvents;

export type EventHandler<T extends EventName> = (
  payload: AppEvents[T],
) => void | Promise<void>;

export class EventBus {
  private static instance: EventBus;
  private listeners: { [K in EventName]?: Set<EventHandler<K>> } = {};

  private constructor() {}

  /**
   * Returns the singleton instance of the EventBus.
   */
  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * Subscribe to an event.
   */
  public on<T extends EventName>(event: T, handler: EventHandler<T>): void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set() as any;
    }
    (this.listeners[event] as any).add(handler);
  }

  /**
   * Unsubscribe from an event.
   */
  public off<T extends EventName>(event: T, handler: EventHandler<T>): void {
    if (this.listeners[event]) {
      (this.listeners[event] as any).delete(handler);
    }
  }

  /**
   * Emit an event. All registered asynchronous handlers will run concurrently.
   * Note: In a true serverless environment, long-running async tasks might be cut off
   * unless explicitly awaited or run using waitUntil. For standard Node.js environments,
   * they will run to completion.
   */
  public async emit<T extends EventName>(
    event: T,
    payload: AppEvents[T],
  ): Promise<void> {
    const handlers = this.listeners[event] as Set<EventHandler<T>> | undefined;
    if (handlers) {
      const promises = Array.from(handlers).map((handler) => {
        try {
          return handler(payload);
        } catch (error) {
          console.error(
            `[EventBus] Error in synchronous handler for event '${event}':`,
            error,
          );
        }
      });

      // Wait for all async handlers to finish
      await Promise.allSettled(promises);
    }
  }

  /**
   * Clears all listeners. Useful for testing.
   */
  public clear(): void {
    this.listeners = {};
  }
}

export const eventBus = EventBus.getInstance();
