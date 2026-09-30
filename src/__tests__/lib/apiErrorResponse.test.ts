/**
 * Tests for API error response shape normalization.
 */

interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

function normalizeError(raw: unknown): ApiError {
  if (typeof raw === "object" && raw !== null && "code" in raw && "message" in raw) {
    const r = raw as Record<string, unknown>;
    return {
      code:       String(r.code ?? "UNKNOWN"),
      message:    String(r.message ?? "An error occurred"),
      statusCode: typeof r.statusCode === "number" ? r.statusCode : 500,
      details:    typeof r.details === "object" && r.details !== null
                    ? (r.details as Record<string, unknown>)
                    : undefined,
    };
  }
  return { code: "UNKNOWN", message: "An unknown error occurred", statusCode: 500 };
}

function isClientError(error: ApiError): boolean {
  return error.statusCode >= 400 && error.statusCode < 500;
}

function isServerError(error: ApiError): boolean {
  return error.statusCode >= 500;
}

function userFriendlyMessage(error: ApiError): string {
  if (isServerError(error)) return "Something went wrong on our end. Please try again.";
  if (error.statusCode === 404) return "The resource you're looking for was not found.";
  if (error.statusCode === 401) return "Please sign in to continue.";
  if (error.statusCode === 403) return "You don't have permission to do that.";
  return error.message;
}

describe("API error response normalization", () => {
  it("normalizes well-formed error", () => {
    const err = normalizeError({ code: "NOT_FOUND", message: "Not found", statusCode: 404 });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.statusCode).toBe(404);
  });

  it("handles null/unknown input", () => {
    const err = normalizeError(null);
    expect(err.code).toBe("UNKNOWN");
    expect(err.statusCode).toBe(500);
  });

  it("isClientError: 404 → true", () => {
    expect(isClientError({ code: "E", message: "M", statusCode: 404 })).toBe(true);
  });

  it("isClientError: 500 → false", () => {
    expect(isClientError({ code: "E", message: "M", statusCode: 500 })).toBe(false);
  });

  it("isServerError: 500 → true", () => {
    expect(isServerError({ code: "E", message: "M", statusCode: 500 })).toBe(true);
  });

  it("userFriendlyMessage: 500 → generic server error", () => {
    const err: ApiError = { code: "ISE", message: "Internal", statusCode: 500 };
    expect(userFriendlyMessage(err)).toMatch(/try again/i);
  });

  it("userFriendlyMessage: 404 → not found", () => {
    const err: ApiError = { code: "NF", message: "Not found", statusCode: 404 };
    expect(userFriendlyMessage(err)).toMatch(/not found/i);
  });

  it("userFriendlyMessage: 401 → sign in", () => {
    const err: ApiError = { code: "UNAUTH", message: "Unauthorized", statusCode: 401 };
    expect(userFriendlyMessage(err)).toMatch(/sign in/i);
  });

  it("userFriendlyMessage: 400 → original message", () => {
    const err: ApiError = { code: "BAD", message: "Bad request: email required", statusCode: 400 };
    expect(userFriendlyMessage(err)).toBe("Bad request: email required");
  });
});
