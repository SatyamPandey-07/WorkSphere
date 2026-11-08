import { NextResponse } from "next/server";

export type ApiErrorBody = {
  success: false;
  error: string;
  code?: string;
};

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VENUE_NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

export const ERROR_CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
};

export function statusToErrorCode(status: number): ApiErrorCode {
  return ERROR_CODE_BY_STATUS[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED");
}

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
