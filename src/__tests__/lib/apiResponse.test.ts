import { apiError } from "@/lib/apiResponse";
import { isApiFailure } from "@/lib/apiClient";

describe("apiError", () => {
  it("returns success:false with message and status", async () => {
    const res = apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: "Venue not found",
      code: "VENUE_NOT_FOUND",
    });
  });

  it("omits code when not provided", async () => {
    const res = apiError("Unauthorized", 401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Unauthorized");
    expect(body.code).toBeUndefined();
  });

  it("carries extra fields for conflict cases", async () => {
    const res = apiError("SEAT_ALREADY_HELD", 409, "CONFLICT", {
      heldBy: "user_1",
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("CONFLICT");
    expect(body.heldBy).toBe("user_1");
  });
});

describe("isApiFailure", () => {
  it("narrows a standard error envelope", () => {
    expect(
      isApiFailure({ success: false, error: "Nope", code: "X" }),
    ).toBe(true);
  });

  it("rejects success payloads and non-objects", () => {
    expect(isApiFailure({ success: true })).toBe(false);
    expect(isApiFailure({ error: "missing success flag" })).toBe(false);
    expect(isApiFailure(null)).toBe(false);
    expect(isApiFailure("error")).toBe(false);
  });
});
