import { NextRequest } from "next/server";
import { POST as refreshRoute } from "@/app/api/auth/session/refresh/route";
import { POST as logoutRoute } from "@/app/api/auth/session/logout/route";
import {
  generateRefreshToken,
  REFRESH_COOKIE_NAME,
  _resetTokenFamilyStoreForTesting,
} from "@/lib/auth/sessionTokens";

describe("/api/auth/session routes", () => {
  beforeEach(() => {
    _resetTokenFamilyStoreForTesting();
  });

  describe("POST /api/auth/session/refresh", () => {
    it("returns 401 when no refresh token is provided", async () => {
      const req = new NextRequest("http://localhost:3000/api/auth/session/refresh", {
        method: "POST",
      });

      const res = await refreshRoute(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe("REFRESH_TOKEN_MISSING");
    });

    it("successfully rotates refresh token from cookie and returns new tokens", async () => {
      const initialToken = await generateRefreshToken("user_route_test");

      const req = new NextRequest("http://localhost:3000/api/auth/session/refresh", {
        method: "POST",
        headers: {
          cookie: `${REFRESH_COOKIE_NAME}=${initialToken}`,
        },
      });

      const res = await refreshRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.userId).toBe("user_route_test");
      expect(typeof data.accessToken).toBe("string");

      const cookieHeader = res.headers.get("set-cookie");
      expect(cookieHeader).toContain(REFRESH_COOKIE_NAME);
    });

    it("returns 401 on token reuse detection", async () => {
      const initialToken = await generateRefreshToken("user_theft_test");

      // First refresh
      const req1 = new NextRequest("http://localhost:3000/api/auth/session/refresh", {
        method: "POST",
        headers: {
          cookie: `${REFRESH_COOKIE_NAME}=${initialToken}`,
        },
      });
      const res1 = await refreshRoute(req1);
      expect(res1.status).toBe(200);

      // Replay attack with same initial token
      const req2 = new NextRequest("http://localhost:3000/api/auth/session/refresh", {
        method: "POST",
        headers: {
          cookie: `${REFRESH_COOKIE_NAME}=${initialToken}`,
        },
      });
      const res2 = await refreshRoute(req2);
      expect(res2.status).toBe(401);
      const data2 = await res2.json();
      expect(data2.code).toBe("REUSE_DETECTED");
    });
  });

  describe("POST /api/auth/session/logout", () => {
    it("revokes token and clears cookies", async () => {
      const token = await generateRefreshToken("user_logout_test");
      const req = new NextRequest("http://localhost:3000/api/auth/session/logout", {
        method: "POST",
        headers: {
          cookie: `${REFRESH_COOKIE_NAME}=${token}`,
        },
      });

      const res = await logoutRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});
