import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { SESSION_COOKIE, verifySessionToken } from "@/server/lib/auth";
import { ApiError } from "@/server/lib/errors";
import { getUserById } from "@/server/services/auth.service";
import type { AuthUser } from "@/shared/auth";
import type { Paginated } from "@/shared/common";

export { ApiError };

/** Success response: `{ data }`. */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

/** List response: `{ data, page, limit, total }`. */
export function okPage<T>(result: Paginated<T>) {
  return NextResponse.json(result, { status: 200 });
}

/** Query string as a plain object, ready for a zod schema: `?page=2&limit=20` → `{ page: "2", limit: "20" }`. */
export function searchParams(request: NextRequest): Record<string, string> {
  return Object.fromEntries(request.nextUrl.searchParams);
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

/** Reads the JSON body; a missing or broken body becomes a 400 instead of a crash. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

/** Like readJson, but an empty body is fine (returns {}). */
export async function readOptionalJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

/** Reads a multipart/form-data upload (file + fields). A wrong content type becomes a 400. */
export async function readFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new ApiError(400, "INVALID_FORM", 'Send the file as multipart/form-data (field "file")');
  }
}

/** Text form fields as a plain object (files are left out), ready for a zod schema. */
export function formFields(form: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") fields[key] = value;
  return fields;
}

/** Returns the signed-in user for this request, or null (no cookie, bad/expired token, user gone). */
export async function getRequestUser(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  return getUserById(session.userId);
}

export type AuthedContext<P> = { user: AuthUser; params: P };

/**
 * Wraps a route handler: loads the signed-in user (401 if missing/invalid), awaits route params,
 * and turns thrown errors into JSON error responses.
 *
 *   export const GET = withAuth(async (req, { user, params }) => ok(...));
 */
export function withAuth<P = Record<string, never>>(
  handler: (request: NextRequest, ctx: AuthedContext<P>) => Promise<Response>,
) {
  return async (request: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      const user = await getRequestUser(request);
      if (!user) return fail(401, "UNAUTHORIZED", "Please log in");
      return await handler(request, { user, params: await ctx.params });
    } catch (err) {
      return handleError(err);
    }
  };
}
