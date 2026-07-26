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

import { isCsrfExemptRoute } from "../middleware";

describe("Middleware CSRF exemptions", () => {
  it("exempts static assets with specified file extensions", () => {
    const assets = [
      "http://localhost/sounds/notification-chime.mp3",
      "http://localhost/icons/pwa-icon.png",
      "http://localhost/images/banner.jpg",
      "http://localhost/images/photo.jpeg",
      "http://localhost/images/logo.svg",
      "http://localhost/favicon.ico",
      "http://localhost/styles/global.css",
      "http://localhost/scripts/main.js",
    ];

    assets.forEach((url) => {
      const mockReq = { url, method: "GET" } as any;
      expect(isCsrfExemptRoute(mockReq)).toBe(true);
    });
  });

  it("exempts webhook and csrf-token routes", () => {
    const urls = [
      "http://localhost/api/webhook/stripe",
      "http://localhost/api/auth/csrf-token",
    ];

    urls.forEach((url) => {
      const mockReq = { url, method: "POST" } as any;
      expect(isCsrfExemptRoute(mockReq)).toBe(true);
    });
  });

  it("does not exempt general API routes without exempt paths or static extensions", () => {
    const urls = [
      "http://localhost/api/bookings",
      "http://localhost/api/folders",
      "http://localhost/api/venues/123/reviews",
    ];

    urls.forEach((url) => {
      const mockReq = { url, method: "POST" } as any;
      expect(isCsrfExemptRoute(mockReq)).toBe(false);
    });
  });
});
