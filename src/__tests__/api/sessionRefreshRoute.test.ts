import {
  POST as refreshPost,
  GET as refreshGet,
} from "@/app/api/auth/session/refresh/route";
import {
  POST as logoutPost,
  GET as logoutGet,
} from "@/app/api/auth/session/logout/route";

describe("Custom session routes (Retired)", () => {
  describe("POST /api/auth/session/refresh", () => {
    it("returns 410 Gone with ENDPOINT_RETIRED code", async () => {
      const res = await refreshPost();
      expect(res.status).toBe(410);

      const data = await res.json();
      expect(data).toEqual({
        error:
          "This endpoint has been retired. WorkSphere utilizes Clerk's native session management.",
        code: "ENDPOINT_RETIRED",
      });
    });

    it("returns 410 Gone on GET request", async () => {
      const res = await refreshGet();
      expect(res.status).toBe(410);

      const data = await res.json();
      expect(data.code).toBe("ENDPOINT_RETIRED");
    });
  });

  describe("POST /api/auth/session/logout", () => {
    it("returns 410 Gone with ENDPOINT_RETIRED code", async () => {
      const res = await logoutPost();
      expect(res.status).toBe(410);

      const data = await res.json();
      expect(data).toEqual({
        error:
          "This endpoint has been retired. WorkSphere utilizes Clerk's native session management.",
        code: "ENDPOINT_RETIRED",
      });
    });

    it("returns 410 Gone on GET request", async () => {
      const res = await logoutGet();
      expect(res.status).toBe(410);

      const data = await res.json();
      expect(data.code).toBe("ENDPOINT_RETIRED");
    });
  });
});
