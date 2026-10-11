import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { apiError } from "@/lib/apiResponse";

export interface ApiHandlerOptions<TBody, TParams> {
  schema?: z.ZodType<TBody>;
  authRequired?: boolean;
  handler: (ctx: {
    body: TBody;
    params: TParams;
    userId?: string;
    req: NextRequest;
  }) => Promise<NextResponse | Response>;
}

/**
 * Standardized API Route Handler Middleware.
 *
 * Automatically handles:
 * - Authentication verification (via Clerk auth())
 * - JSON parsing error handling
 * - Zod schema validation & formatted field errors
 * - Param promise resolution for Next.js dynamic routes
 * - Uniform error response formatting via apiError()
 */
export function apiHandler<TBody = any, TParams = any>({
  schema,
  authRequired = false,
  handler,
}: ApiHandlerOptions<TBody, TParams>) {
  return async (
    req: NextRequest,
    context?: { params?: Promise<TParams> | TParams },
  ): Promise<NextResponse | Response> => {
    try {
      // 1. Authentication Check
      let userId: string | undefined;
      try {
        const authResult = await auth();
        userId = authResult?.userId ?? undefined;
      } catch {
        // Auth resolution failed or not available in current context
      }

      if (authRequired && !userId) {
        return apiError("Unauthorized", 401, "UNAUTHORIZED");
      }

      // 2. Resolve Dynamic Route Params
      let params = {} as TParams;
      if (context?.params) {
        params =
          context.params instanceof Promise
            ? await context.params
            : context.params;
      }

      // 3. Body Extraction & JSON Parsing
      let body: any = undefined;
      const method = req.method?.toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        try {
          const text = await req.text();
          if (text && text.trim().length > 0) {
            body = JSON.parse(text);
          } else {
            body = {};
          }
        } catch {
          return apiError("Invalid JSON body", 400, "VALIDATION_FAILED");
        }
      }

      // 4. Schema Validation
      if (schema) {
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          const firstIssue = parsed.error.issues[0];
          const errorMessage = firstIssue?.message || "Validation failed";
          return apiError(errorMessage, 400, "VALIDATION_FAILED", {
            details: parsed.error.flatten().fieldErrors,
          });
        }
        body = parsed.data;
      }

      // 5. Execute Handler
      return await handler({
        body: body as TBody,
        params,
        userId,
        req,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        const firstIssue = error.issues[0];
        const errorMessage = firstIssue?.message || "Validation failed";
        return apiError(errorMessage, 400, "VALIDATION_FAILED", {
          details: error.flatten().fieldErrors,
        });
      }

      console.error("[apiHandler] Unhandled route error:", error);
      return apiError(
        error?.message || "Internal server error",
        500,
        "INTERNAL_ERROR",
      );
    }
  };
}
