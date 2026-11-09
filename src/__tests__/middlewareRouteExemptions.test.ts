jest.mock("@upstash/redis", () => ({}));
jest.mock("../lib/performanceTelemetry", () => ({
  recordApiLatency: jest.fn(),
}));
jest.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: jest.fn(),
  createRouteMatcher: jest.fn((patterns: string[]) => {
    return (req: any) => {
      const url = new URL(req.url);
      const path = url.pathname;
      return patterns.some((pattern) => {
        const regexStr = pattern.replace("(.*)", ".*");
        const regex = new RegExp(`^${regexStr}$`);
        return regex.test(path);
      });
    };
  }),
}));

import {
  isCsrfExemptRoute,
  ROUTE_PERMISSIONS,
} from "../middleware";
import { isPublicRoute, isAdminRoute } from "../lib/middleware/routes";

describe("ROUTE_PERMISSIONS Manifest and Route Classification", () => {
  it("defines valid route permissions rules with required properties", () => {
    expect(ROUTE_PERMISSIONS.length).toBeGreaterThan(0);
    ROUTE_PERMISSIONS.forEach((rule) => {
      expect(rule.pattern).toBeDefined();
      expect(typeof rule.pattern).toBe("string");
      if (rule.description) {
        expect(typeof rule.description).toBe("string");
      }
    });
  });

  describe("Public Routes Matcher", () => {
    const publicUrls = [
      "http://localhost/",
      "http://localhost/sign-in",
      "http://localhost/sign-up",
      "http://localhost/venues",
      "http://localhost/venues/123",
      "http://localhost/collections/public/col-456",
      "http://localhost/collections/join/token-xyz",
      "http://localhost/s/short-123",
      "http://localhost/offline",
      "http://localhost/privacy",
      "http://localhost/terms",
      "http://localhost/api/venues",
      "http://localhost/api/venues/search",
      "http://localhost/api/map/tile/1/2/3",
      "http://localhost/api/collections/public/col-456",
      "http://localhost/api/webhook",
      "http://localhost/api/webhook/stripe",
      "http://localhost/api/webhooks/worker",
      "http://localhost/api/cron/cleanup",
      "http://localhost/api/auth/csrf-token",
      "http://localhost/api/auth/sso/saml",
      "http://localhost/api/auth/passkey/authenticate/start",
      "http://localhost/api/auth/session/refresh",
    ];

    publicUrls.forEach((url) => {
      it(`recognizes ${url} as public`, () => {
        const mockReq = { url, method: "GET" } as any;
        expect(isPublicRoute(mockReq)).toBe(true);
      });
    });

    const protectedUrls = [
      "http://localhost/dashboard",
      "http://localhost/bookings",
      "http://localhost/profile",
      "http://localhost/api/bookings",
      "http://localhost/api/favorites",
      "http://localhost/api/user/settings",
    ];

    protectedUrls.forEach((url) => {
      it(`recognizes ${url} as protected (non-public)`, () => {
        const mockReq = { url, method: "GET" } as any;
        expect(isPublicRoute(mockReq)).toBe(false);
      });
    });
  });

  describe("Admin Routes Matcher", () => {
    const adminUrls = [
      "http://localhost/admin",
      "http://localhost/admin/users",
      "http://localhost/admin/analytics",
      "http://localhost/api/admin/metrics",
      "http://localhost/api/admin/venues",
    ];

    adminUrls.forEach((url) => {
      it(`identifies ${url} as an admin-only route`, () => {
        const mockReq = { url, method: "GET" } as any;
        expect(isAdminRoute(mockReq)).toBe(true);
      });
    });

    const nonAdminUrls = [
      "http://localhost/",
      "http://localhost/venues",
      "http://localhost/api/venues",
      "http://localhost/dashboard",
      "http://localhost/api/bookings",
    ];

    nonAdminUrls.forEach((url) => {
      it(`identifies ${url} as not an admin route`, () => {
        const mockReq = { url, method: "GET" } as any;
        expect(isAdminRoute(mockReq)).toBe(false);
      });
    });
  });

  describe("CSRF Exemption across HTTP Methods", () => {
    const exemptEndpoints = [
      "http://localhost/api/webhook",
      "http://localhost/api/webhook/svix",
      "http://localhost/api/webhooks/worker",
      "http://localhost/api/cron/partition-maintenance",
      "http://localhost/api/auth/csrf-token",
      "http://localhost/api/auth/sso/saml",
      "http://localhost/api/venues/updates",
      "http://localhost/api/auth/session/refresh",
    ];

    const methods = ["POST", "PUT", "PATCH", "DELETE", "GET", "OPTIONS"];

    exemptEndpoints.forEach((url) => {
      methods.forEach((method) => {
        it(`exempts ${method} requests to ${url} from CSRF check`, () => {
          const mockReq = { url, method } as any;
          expect(isCsrfExemptRoute(mockReq)).toBe(true);
        });
      });
    });

    const nonExemptMutatingEndpoints = [
      "http://localhost/api/bookings",
      "http://localhost/api/folders",
      "http://localhost/api/venues/v-123/reviews",
      "http://localhost/api/user/profile",
    ];

    const mutatingMethods = ["POST", "PUT", "PATCH", "DELETE"];

    nonExemptMutatingEndpoints.forEach((url) => {
      mutatingMethods.forEach((method) => {
        it(`requires CSRF verification for mutating ${method} ${url}`, () => {
          const mockReq = { url, method } as any;
          expect(isCsrfExemptRoute(mockReq)).toBe(false);
        });
      });
    });
  });
});
