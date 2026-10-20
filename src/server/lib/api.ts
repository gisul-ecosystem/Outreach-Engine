import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Throw this from services to return a specific HTTP error from a route handler. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Success response: `{ data }`. */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

/** Error response: `{ error: { code, message } }`. */
export function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Turns any thrown error into a safe JSON error response. Unknown errors never leak details. */
export function handleError(err: unknown) {
  if (err instanceof ApiError) {
    return fail(err.status, err.code, err.message);
  }
  if (err instanceof ZodError) {
    const message = err.issues
      .map((issue) =>
        issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      )
      .join("; ");
    return fail(400, "VALIDATION_ERROR", message);
  }
  console.error("[api] unexpected error:", err instanceof Error ? err.message : err);
  return fail(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
}
