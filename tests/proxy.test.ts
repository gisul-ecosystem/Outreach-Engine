import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSessionToken } from "@/server/lib/auth";
import { proxy } from "@/proxy";

async function validToken() {
  return signSessionToken({ userId: "652f0c0c0c0c0c0c0c0c0c0c", email: "a@b.co", role: "admin" });
}

function request(path: string, token?: string) {
  const headers = token ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined;
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

const isPassThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy (route protection)", () => {
  it.each(["/", "/campaigns", "/domains/123"])(
    "redirects %s to /login when logged out",
    async (path) => {
      const res = await proxy(request(path));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/login");
    },
  );

  it.each(["/api/domains", "/api/campaigns/1/start", "/api/dashboard/summary"])(
    "returns 401 JSON for %s when logged out",
    async (path) => {
      const res = await proxy(request(path));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Please log in" },
      });
    },
  );

  it.each(["/api/health", "/api/auth/login", "/api/auth/logout", "/api/auth/me"])(
    "lets %s through without login",
    async (path) => {
      expect(isPassThrough(await proxy(request(path)))).toBe(true);
    },
  );

  it.each(["/r/k7f2Qa9xLm_3", "/r/anything"])(
    "lets the public tracking link %s through without login",
    async (path) => {
      expect(isPassThrough(await proxy(request(path)))).toBe(true);
    },
  );

  // Only the /r/ prefix is public: everything else still needs a login.
  it.each(["/r", "/redirect", "/reports", "/sent", "/contacts", "/rr/abc"])(
    "still redirects %s to /login when logged out",
    async (path) => {
      expect((await proxy(request(path))).status).toBe(307);
    },
  );

  it.each([
    "/api/r/abc",
    "/api/contacts/652f0c0c0c0c0c0c0c0c0c0c/links",
    "/api/lists/652f0c0c0c0c0c0c0c0c0c0c/links.csv",
    "/api/tracking/clicks",
    "/api/dashboard/clickers",
    "/api/tracking/config",
    "/api/sent-emails",
    "/api/sent-emails/stats",
  ])("still returns 401 for %s when logged out", async (path) => {
    expect((await proxy(request(path))).status).toBe(401);
  });

  it("shows /login when logged out", async () => {
    expect(isPassThrough(await proxy(request("/login")))).toBe(true);
  });

  it("sends a logged-in user from /login to /", async () => {
    const res = await proxy(request("/login", await validToken()));
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("lets a logged-in user through to pages and API", async () => {
    const token = await validToken();
    expect(isPassThrough(await proxy(request("/campaigns", token)))).toBe(true);
    expect(isPassThrough(await proxy(request("/api/domains", token)))).toBe(true);
  });

  it("treats an invalid token as logged out", async () => {
    expect((await proxy(request("/api/domains", "garbage"))).status).toBe(401);
  });
});
