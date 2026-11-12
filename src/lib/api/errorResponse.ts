import { NextResponse } from "next/server";

export interface ApiFieldError {
  field: string;
  issue: string;
}

export interface ApiErrorResponseBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  errors?: ApiFieldError[];
}

export interface ErrorResponseDetails {
  instance?: string;
  errors?: ApiFieldError[];
  type?: string;
  title?: string;
  headers?: HeadersInit | Record<string, string>;
  code?: string;
}

export const HTTP_STATUS_TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/**
 * Custom application API error with standardized JSON-API attributes.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly instance?: string;
  public readonly errors?: ApiFieldError[];
  public readonly headers?: HeadersInit;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ErrorResponseDetails | ApiFieldError[],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;

    const normalized: ErrorResponseDetails = Array.isArray(details)
      ? { errors: details }
      : details || {};

    this.instance = normalized.instance;
    this.errors = normalized.errors;
    this.headers = normalized.headers;
  }

  static badRequest(message = "Bad request", details?: ErrorResponseDetails | ApiFieldError[]) {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Unauthorized", details?: ErrorResponseDetails | ApiFieldError[]) {
    return new ApiError(401, "UNAUTHORIZED", message, details);
  }

  static forbidden(message = "Forbidden", details?: ErrorResponseDetails | ApiFieldError[]) {
    return new ApiError(403, "FORBIDDEN", message, details);
  }

  static notFound(message = "Resource not found", details?: ErrorResponseDetails | ApiFieldError[]) {
    return new ApiError(404, "NOT_FOUND", message, details);
  }

  static conflict(message = "Conflict", details?: ErrorResponseDetails | ApiFieldError[]) {
    return new ApiError(409, "CONFLICT", message, details);
  }

  static tooManyRequests(message = "Too many requests. Please try again later.", details?: ErrorResponseDetails | ApiFieldError[]) {
    return new ApiError(429, "TOO_MANY_REQUESTS", message, details);
  }

  static internalServerError(message = "Internal server error", details?: ErrorResponseDetails | ApiFieldError[]) {
    return new ApiError(500, "INTERNAL_SERVER_ERROR", message, details);
  }
}

/**
 * Creates a standardized JSON-API RFC 7807 problem details response.
 *
 * Response Structure:
 * {
 *   type: string,
 *   title: string,
 *   status: number,
 *   detail: string,
 *   instance?: string,
 *   errors?: Array<{ field: string, issue: string }>
 * }
 */
export function createErrorResponse(
  status: number,
  code: string,
  message: string,
  details?: ErrorResponseDetails | ApiFieldError[],
): NextResponse<ApiErrorResponseBody> {
  const normalizedDetails: ErrorResponseDetails = Array.isArray(details)
    ? { errors: details }
    : details || {};

  const title =
    normalizedDetails.title ||
    HTTP_STATUS_TITLES[status] ||
    code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const slug = code.toLowerCase().replace(/_/g, "-");
  const type =
    normalizedDetails.type ||
    `https://api.worksphere.com/errors/${slug}`;

  const body: ApiErrorResponseBody = {
    type,
    title,
    status,
    detail: message,
  };

  if (normalizedDetails.instance) {
    body.instance = normalizedDetails.instance;
  }

  if (normalizedDetails.errors && normalizedDetails.errors.length > 0) {
    body.errors = normalizedDetails.errors;
  }

  const headers = new Headers(normalizedDetails.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/problem+json");
  }

  return NextResponse.json(body, {
    status,
    headers,
  });
}

// Standard HTTP Status Helpers
export function badRequest(
  message = "Bad request",
  details?: ErrorResponseDetails | ApiFieldError[],
) {
  return createErrorResponse(400, "BAD_REQUEST", message, details);
}

export function unauthorized(
  message = "Unauthorized",
  details?: ErrorResponseDetails | ApiFieldError[],
) {
  return createErrorResponse(401, "UNAUTHORIZED", message, details);
}

export function forbidden(
  message = "Forbidden",
  details?: ErrorResponseDetails | ApiFieldError[],
) {
  return createErrorResponse(403, "FORBIDDEN", message, details);
}

export function notFound(
  message = "Resource not found",
  details?: ErrorResponseDetails | ApiFieldError[],
) {
  return createErrorResponse(404, "NOT_FOUND", message, details);
}

export function conflict(
  message = "Conflict",
  details?: ErrorResponseDetails | ApiFieldError[],
) {
  return createErrorResponse(409, "CONFLICT", message, details);
}

export function tooManyRequests(
  message = "Too many requests. Please try again later.",
  details?: ErrorResponseDetails | ApiFieldError[],
) {
  return createErrorResponse(429, "TOO_MANY_REQUESTS", message, details);
}

export function internalServerError(
  message = "Internal server error",
  details?: ErrorResponseDetails | ApiFieldError[],
) {
  return createErrorResponse(500, "INTERNAL_SERVER_ERROR", message, details);
}

/**
 * Handles errors caught in route handlers and formats them into a standardized error response.
 */
export function handleApiError(
  error: unknown,
  req?: Request | { url?: string; nextUrl?: { pathname?: string } },
): NextResponse<ApiErrorResponseBody> {
  const instance =
    (req as any)?.nextUrl?.pathname ||
    (typeof (req as any)?.url === "string"
      ? new URL((req as any).url, "http://localhost").pathname
      : undefined);

  if (error instanceof ApiError) {
    return createErrorResponse(error.status, error.code, error.message, {
      instance: error.instance || instance,
      errors: error.errors,
      headers: error.headers,
    });
  }

  // Zod validation error detection
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray((error as any).issues)
  ) {
    const errors: ApiFieldError[] = (error as any).issues.map((issue: any) => ({
      field: Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path || ""),
      issue: issue.message || "Invalid input",
    }));

    return badRequest("Validation failed", {
      instance,
      errors,
    });
  }

  if (error instanceof Error) {
    const message =
      process.env.NODE_ENV === "production"
        ? "An internal server error occurred"
        : error.message || "Internal server error";

    return internalServerError(message, { instance });
  }

  return internalServerError("An unexpected error occurred", { instance });
}

/**
 * Middleware wrapper for API route handlers that catches any thrown error
 * and returns a standardized JSON-API error response.
 */
export function withErrorHandler<
  T extends (...args: any[]) => Promise<Response | NextResponse | any> | Response | NextResponse | any,
>(handler: T): T {
  return (async (...args: any[]) => {
    try {
      return await handler(...args);
    } catch (error: any) {
      const req = args[0];
      return handleApiError(error, req);
    }
  }) as T;
}

export const errorResponses = {
  create: createErrorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  internalServerError,
  handle: handleApiError,
  middleware: withErrorHandler,
};

export default createErrorResponse;
