import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { User } from "@/server/db/models";
import { ok, withAuth } from "@/server/lib/api";
import { SESSION_COOKIE, signSessionToken } from "@/server/lib/auth";
import { startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

let userId: string;

beforeAll(async () => {
  await startMemoryDb();
  const user = await User.create({ email: "admin@racko.in", passwordHash: "x", role: "admin" });
  userId = String(user._id);
});
afterAll(stopMemoryDb);

const handler = withAuth<{ id: string }>(async (_req, { user, params }) =>
  ok({ email: user.email, id: params.id }),
);
const ctx = { params: Promise.resolve({ id: "abc" }) };

function requestWithCookie(token?: string) {
  const headers = token ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined;
  return new NextRequest("http://localhost:3000/api/test", { headers });
}

describe("withAuth", () => {
  it("returns 401 without a cookie", async () => {
    const res = await handler(requestWithCookie(), ctx);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Please log in" } });
  });

  it("returns 401 for an invalid token", async () => {
    expect((await handler(requestWithCookie("garbage"), ctx)).status).toBe(401);
  });

  it("returns 401 when the user no longer exists", async () => {
    const token = await signSessionToken({
      userId: "652f0c0c0c0c0c0c0c0c0c0c",
      email: "gone@racko.in",
      role: "admin",
    });
    expect((await handler(requestWithCookie(token), ctx)).status).toBe(401);
  });

  it("passes the user and awaited params to the handler", async () => {
    const token = await signSessionToken({ userId, email: "admin@racko.in", role: "admin" });
    const res = await handler(requestWithCookie(token), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { email: "admin@racko.in", id: "abc" } });
  });

  it("turns thrown errors into JSON errors", async () => {
    const token = await signSessionToken({ userId, email: "admin@racko.in", role: "admin" });
    const failing = withAuth(async () => {
      throw new Error("boom");
    });
    const res = await failing(requestWithCookie(token), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
  });
});
