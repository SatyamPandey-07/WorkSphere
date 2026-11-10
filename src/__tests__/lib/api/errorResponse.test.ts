import {
  createErrorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  internalServerError,
  handleApiError,
  withErrorHandler,
  ApiError,
  ApiFieldError,
} from "@/lib/api/errorResponse";

describe("Standardized JSON-API Error Formatter", () => {
  describe("createErrorResponse", () => {
    it("creates a standardized JSON-API error response matching the required structure", async () => {
      const response = createErrorResponse(
        400,
        "INVALID_INPUT",
        "The provided email format is invalid.",
        {
          instance: "/api/users",
          errors: [{ field: "email", issue: "Must be a valid email" }],
        },
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toBe("application/problem+json");

      const body = await response.json();
      expect(body).toEqual({
        type: "https://api.worksphere.com/errors/invalid-input",
        title: "Bad Request",
        status: 400,
        detail: "The provided email format is invalid.",
        instance: "/api/users",
        errors: [{ field: "email", issue: "Must be a valid email" }],
      });
    });

    it("omits optional instance and errors when not provided", async () => {
      const response = createErrorResponse(
        404,
        "NOT_FOUND",
        "Venue with id v123 was not found.",
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.status).toBe(404);
      expect(body.title).toBe("Not Found");
      expect(body.detail).toBe("Venue with id v123 was not found.");
      expect(body.instance).toBeUndefined();
      expect(body.errors).toBeUndefined();
    });

    it("supports passing an array of ApiFieldError directly as details parameter", async () => {
      const fieldErrors: ApiFieldError[] = [
        { field: "username", issue: "Too short" },
        { field: "password", issue: "Requires a number" },
      ];

      const response = createErrorResponse(
        422,
        "UNPROCESSABLE_ENTITY",
        "Validation errors occurred",
        fieldErrors,
      );

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.errors).toEqual(fieldErrors);
    });
  });

  describe("Standard HTTP Status Helpers", () => {
    it("badRequest helper creates 400 Bad Request error", async () => {
      const response = badRequest("Invalid query parameter", {
        instance: "/api/search",
        errors: [{ field: "q", issue: "Query cannot be empty" }],
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.status).toBe(400);
      expect(body.title).toBe("Bad Request");
      expect(body.detail).toBe("Invalid query parameter");
      expect(body.instance).toBe("/api/search");
      expect(body.errors).toEqual([{ field: "q", issue: "Query cannot be empty" }]);
    });

    it("unauthorized helper creates 401 Unauthorized error", async () => {
      const response = unauthorized("Session expired");

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.status).toBe(401);
      expect(body.title).toBe("Unauthorized");
      expect(body.detail).toBe("Session expired");
    });

    it("forbidden helper creates 403 Forbidden error", async () => {
      const response = forbidden("Admin privileges required");

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.status).toBe(403);
      expect(body.title).toBe("Forbidden");
      expect(body.detail).toBe("Admin privileges required");
    });

    it("notFound helper creates 404 Not Found error", async () => {
      const response = notFound("Session not found");

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.status).toBe(404);
      expect(body.title).toBe("Not Found");
      expect(body.detail).toBe("Session not found");
    });

    it("conflict helper creates 409 Conflict error", async () => {
      const response = conflict("Seat already booked");

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.status).toBe(409);
      expect(body.title).toBe("Conflict");
      expect(body.detail).toBe("Seat already booked");
    });

    it("tooManyRequests helper creates 429 Too Many Requests error", async () => {
      const response = tooManyRequests("Rate limit exceeded");

      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.status).toBe(429);
      expect(body.title).toBe("Too Many Requests");
      expect(body.detail).toBe("Rate limit exceeded");
    });

    it("internalServerError helper creates 500 Internal Server Error", async () => {
      const response = internalServerError();

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.status).toBe(500);
      expect(body.title).toBe("Internal Server Error");
      expect(body.detail).toBe("Internal server error");
    });
  });

  describe("ApiError class", () => {
    it("instantiates correctly and exposes typed properties", () => {
      const err = new ApiError(403, "FORBIDDEN", "Access denied", {
        instance: "/api/admin",
        errors: [{ field: "role", issue: "Insufficient permissions" }],
      });

      expect(err.name).toBe("ApiError");
      expect(err.status).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
      expect(err.message).toBe("Access denied");
      expect(err.instance).toBe("/api/admin");
      expect(err.errors).toEqual([{ field: "role", issue: "Insufficient permissions" }]);
    });

    it("provides static factory constructors", () => {
      expect(ApiError.badRequest().status).toBe(400);
      expect(ApiError.unauthorized().status).toBe(401);
      expect(ApiError.forbidden().status).toBe(403);
      expect(ApiError.notFound().status).toBe(404);
      expect(ApiError.conflict().status).toBe(409);
      expect(ApiError.tooManyRequests().status).toBe(429);
      expect(ApiError.internalServerError().status).toBe(500);
    });
  });

  describe("withErrorHandler Middleware", () => {
    it("passes through successful responses", async () => {
      const handler = withErrorHandler(async () => {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const res = await handler(new Request("http://localhost/api/test"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("catches thrown ApiError and formats it into standardized response", async () => {
      const handler = withErrorHandler(async () => {
        throw ApiError.notFound("User not found");
      });

      const res = await handler(new Request("http://localhost/api/users/99"));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.title).toBe("Not Found");
      expect(body.detail).toBe("User not found");
      expect(body.instance).toBe("/api/users/99");
    });

    it("catches ZodError and formats validation field errors", async () => {
      const fakeZodError = {
        name: "ZodError",
        issues: [
          { path: ["email"], message: "Invalid email" },
          { path: ["profile", "age"], message: "Must be at least 18" },
        ],
      };

      const handler = withErrorHandler(async () => {
        throw fakeZodError;
      });

      const res = await handler(new Request("http://localhost/api/register"));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.title).toBe("Bad Request");
      expect(body.detail).toBe("Validation failed");
      expect(body.errors).toEqual([
        { field: "email", issue: "Invalid email" },
        { field: "profile.age", issue: "Must be at least 18" },
      ]);
    });

    it("catches generic unexpected errors and returns 500", async () => {
      const handler = withErrorHandler(async () => {
        throw new Error("Database connection lost");
      });

      const res = await handler(new Request("http://localhost/api/items"));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.title).toBe("Internal Server Error");
    });
  });
});
