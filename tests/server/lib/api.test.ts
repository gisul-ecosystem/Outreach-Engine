import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, fail, handleError, ok } from "@/server/lib/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ok", () => {
  it("wraps data in { data } with status 200", async () => {
    const res = ok({ hello: "world" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { hello: "world" } });
  });

  it("accepts a custom status", () => {
    expect(ok({ id: 1 }, 201).status).toBe(201);
  });
});

describe("fail", () => {
  it("returns { error: { code, message } } with the given status", async () => {
    const res = fail(404, "NOT_FOUND", "Domain not found");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Domain not found" } });
  });
});

describe("handleError", () => {
  it("maps ApiError to its status and code", async () => {
    const res = handleError(new ApiError(409, "DUPLICATE", "Already exists"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "DUPLICATE", message: "Already exists" } });
  });

  it("maps zod errors to 400 VALIDATION_ERROR with the field name", async () => {
    const result = z.object({ email: z.email() }).safeParse({ email: "nope" });
    expect(result.success).toBe(false);
    const res = handleError(result.error);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("email");
  });

  it("hides details of unknown errors behind a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = handleError(new Error("connection string mongodb://secret@host"));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("secret");
  });
});
