import { NextResponse } from "next/server";

export type ApiErrorBody = {
  success: false;
  error: string;
  code?: string;
};

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "VENUE_NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export function apiError(
  message: string,
  status: number,
  code?: ApiErrorCode | string,
  extra?: Record<string, unknown>,
): NextResponse {
  const body: ApiErrorBody & Record<string, unknown> = {
    success: false,
    error: message,
  };
  if (code) body.code = code;
  if (extra) Object.assign(body, extra);
  return NextResponse.json(body, { status });
}

export function apiSuccess<T extends Record<string, unknown>>(
  payload: T,
  status = 200,
): NextResponse {
  return NextResponse.json({ success: true, ...payload }, { status });
}
