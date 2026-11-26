import { getAppUrl, appUrl } from "@/lib/appUrl";

describe("getAppUrl & appUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns default localhost:3000 when no environment variables are set", () => {
    expect(getAppUrl()).toBe("http://localhost:3000");
    expect(appUrl("/venues")).toBe("http://localhost:3000/venues");
  });

  it("handles NEXT_PUBLIC_APP_URL without protocol by prepending https://", () => {
    process.env.NEXT_PUBLIC_APP_URL = "work-sphere-one.vercel.app";
    expect(getAppUrl()).toBe("https://work-sphere-one.vercel.app");
    expect(appUrl("/api/health")).toBe("https://work-sphere-one.vercel.app/api/health");
  });

  it("preserves explicit https:// in NEXT_PUBLIC_APP_URL and strips trailing slashes", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://custom.worksphere.com///";
    expect(getAppUrl()).toBe("https://custom.worksphere.com");
    expect(appUrl("dashboard")).toBe("https://custom.worksphere.com/dashboard");
  });

  it("falls back to VERCEL_URL when NEXT_PUBLIC_APP_URL is empty", () => {
    process.env.VERCEL_URL = "preview-deployment.vercel.app";
    expect(getAppUrl()).toBe("https://preview-deployment.vercel.app");
  });
});
