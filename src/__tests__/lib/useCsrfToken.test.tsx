import { useCsrfToken } from "@/hooks/useCsrfToken";
import { renderHook } from "@testing-library/react";

// Mock Clerk
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isSignedIn: true,
    isLoaded: true,
    user: { id: "user_123" },
  }),
}));

// Mock i18next
jest.mock("i18next", () => ({
  on: jest.fn(),
  off: jest.fn(),
}));

describe("useCsrfToken fetch interceptor auto-retry", () => {
  let originalFetch: typeof window.fetch;

  beforeAll(() => {
    originalFetch = window.fetch;
  });

  afterAll(() => {
    window.fetch = originalFetch;
  });

  it("automatically refreshes CSRF token and retries a failed mutating request", async () => {
    let csrfTokenCallCount = 0;
    let mainCallCount = 0;

    window.fetch = jest
      .fn()
      .mockImplementation(async (input: any, init: any) => {
        const url = typeof input === "string" ? input : input.url;

        if (url.includes("/api/auth/csrf-token")) {
          csrfTokenCallCount++;
          return {
            ok: true,
            status: 200,
            headers: {
              get(name: string) {
                if (name.toLowerCase() === "content-type")
                  return "application/json";
                return null;
              },
            },
            json: async () => ({
              csrfToken: `new-csrf-token-${csrfTokenCallCount}`,
            }),
          };
        }

        if (url.includes("/api/test-mutation")) {
          mainCallCount++;
          if (mainCallCount === 1) {
            // First attempt fails with 403 CSRF validation error
            return {
              ok: false,
              status: 403,
              headers: {
                get(name: string) {
                  if (name.toLowerCase() === "content-type")
                    return "application/json";
                  return null;
                },
              },
              clone: function () {
                return this;
              },
              json: async () => ({ error: "CSRF validation failed." }),
            };
          } else {
            // Second attempt (retry) succeeds
            return {
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                receivedToken: init.headers.get("x-csrf-token"),
              }),
            };
          }
        }

        return { ok: true, status: 200 };
      }) as any;

    // Render hook to register fetch interceptor
    renderHook(() => useCsrfToken());

    // Trigger initial mutation request
    const response = await fetch("/api/test-mutation", {
      method: "POST",
      body: JSON.stringify({ data: "test" }),
    });

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.receivedToken).toBe("new-csrf-token-2");
    expect(csrfTokenCallCount).toBe(2); // Initial load + 403 refresh load
    expect(mainCallCount).toBe(2); // Initial attempt + retry attempt
  });
});
