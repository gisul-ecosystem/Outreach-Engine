// Browser-side helper for calling our own /api routes.
// Unwraps `{ data }` on success and throws ApiClientError with the server's `{ error: { code, message } }`.
import type { Paginated } from "@/shared/common";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

/** Calls an endpoint that returns `{ data }` and gives back `data`. */
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const json = await request<{ data?: T }>(path, options);
  return json.data as T;
}

/** Calls a list endpoint and gives back the whole `{ data, page, limit, total }`. */
export async function apiFetchPage<T>(
  path: string,
  options: ApiOptions = {},
): Promise<Paginated<T>> {
  return request<Paginated<T>>(path, options);
}

/** Uploads a file (multipart/form-data) to an endpoint that returns `{ data }`. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw new ApiClientError(
      0,
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection.",
    );
  }
  const json = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code: string; message: string };
  } | null;
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      json?.error?.code ?? "HTTP_ERROR",
      json?.error?.message ?? `Upload failed (${response.status})`,
    );
  }
  return json?.data as T;
}

async function request<T>(path: string, options: ApiOptions): Promise<T> {
  const { body, headers, ...rest } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError(
      0,
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection.",
    );
  }

  const json = (await response.json().catch(() => null)) as
    (T & { error?: { code: string; message: string } }) | null;

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      json?.error?.code ?? "HTTP_ERROR",
      json?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return (json ?? {}) as T;
}

/** True when the session is missing or expired (not for a wrong password, which is INVALID_CREDENTIALS). */
export function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 401 && err.code === "UNAUTHORIZED";
}

/** Message to show in a toast for any error thrown by apiFetch (or anything else). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}
