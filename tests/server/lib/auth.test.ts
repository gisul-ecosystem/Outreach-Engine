import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  clearedSessionCookieOptions,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from "@/server/lib/auth";

const session = {
  userId: "652f0c0c0c0c0c0c0c0c0c0c",
  email: "admin@racko.in",
  role: "admin" as const,
};

describe("session tokens (jose)", () => {
  it("signs and verifies a token", async () => {
    const token = await signSessionToken(session);
    expect(await verifySessionToken(token)).toEqual(session);
  });

  it("expires after 7 days", async () => {
    const token = await signSessionToken(session);
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSessionToken(session, "another-secret-that-is-long-enough-xyz");
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await signSessionToken(session);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: session.userId, role: "admin" })).toString(
      "base64url",
    );
    expect(await verifySessionToken(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const expired = await new SignJWT({ email: session.email, role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(session.userId)
      .setIssuer("outreach-engine")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);
    expect(await verifySessionToken(expired)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
  });
});

describe("cookie options", () => {
  it("is httpOnly + sameSite lax, not secure outside production", () => {
    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
  });

  it("clearing the cookie sets maxAge 0", () => {
    expect(clearedSessionCookieOptions().maxAge).toBe(0);
  });
});
