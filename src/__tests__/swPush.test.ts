import fs from "fs";
import path from "path";

describe("Service Worker Push Notifications", () => {
  let listeners: Record<string, ((...args: any[]) => any)[]> = {};
  let showNotificationMock: jest.Mock;

  beforeEach(() => {
    listeners = {};
    showNotificationMock = jest.fn();

    const addEventListenerMock = jest.fn((event, callback) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(callback);
    });

    const originalSelf = (global as any).self;
    const mockRegistration = {
      showNotification: showNotificationMock,
    };
    (global as any).addEventListener = addEventListenerMock;
    (global as any).registration = mockRegistration;
    (global as any).self = {
      ...originalSelf,
      addEventListener: addEventListenerMock,
      registration: mockRegistration,
      location: { origin: "http://localhost" },
      clients: {
        matchAll: jest.fn().mockResolvedValue([]),
        claim: jest.fn(),
      },
      skipWaiting: jest.fn(),
    };

    (global as any).caches = {
      open: jest.fn().mockResolvedValue({
        match: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        addAll: jest.fn(),
      }),
      match: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    };
    (global as any).indexedDB = {
      open: jest.fn().mockReturnValue({
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      }),
    };

    // Polyfill for Request / Response
    (global as any).fetch = jest.fn();
    (global as any).Request = class Request {};
    (global as any).Response = class Response {};
    (global as any).btoa = jest.fn((str) =>
      Buffer.from(str).toString("base64"),
    );

    const swPath = path.join(process.cwd(), "public/sw.js");
    const swCode = fs.readFileSync(swPath, "utf-8");

    try {
      eval(swCode);
    } catch (e) {
      console.error("Eval error", e);
    }
  });

  afterEach(() => {
    delete (global as any).self;
    delete (global as any).registration;
    delete (global as any).caches;
    delete (global as any).indexedDB;
    delete (global as any).fetch;
    delete (global as any).Request;
    delete (global as any).Response;
    delete (global as any).btoa;
  });

  it("should display default notification under invalid JSON payload", () => {
    const pushHandlers = listeners["push"] || [];
    expect(pushHandlers.length).toBeGreaterThan(0);

    const event = {
      waitUntil: jest.fn((promise) => promise),
      data: {
        text: () => "Invalid JSON string",
        json: () => {
          throw new Error("JSON Parse error");
        },
      },
    };

    pushHandlers.forEach((handler) => handler(event));

    expect(showNotificationMock).toHaveBeenCalled();
    const [title, options] = showNotificationMock.mock.calls[0];

    expect(title).toBe("WorkSphere");
    expect(options.body).toBe("Invalid JSON string");
    expect(options.icon).toBe("/icons/icon.svg");
    expect(options.badge).toBe("/icons/icon.svg");
  });

  it("should display default notification when payload is entirely missing", () => {
    const pushHandlers = listeners["push"] || [];
    expect(pushHandlers.length).toBeGreaterThan(0);

    const event = {
      waitUntil: jest.fn((promise) => promise),
      data: null,
    };

    pushHandlers.forEach((handler) => handler(event));

    expect(showNotificationMock).toHaveBeenCalled();
    const [title, options] = showNotificationMock.mock.calls[0];

    expect(title).toBe("WorkSphere");
    expect(options.body).toBe("New update from WorkSphere");
    expect(options.icon).toBe("/icons/icon.svg");
  });
});
