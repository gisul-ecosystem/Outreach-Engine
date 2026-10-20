import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env";

const valid = {
  MONGODB_URI: "mongodb://localhost:27018/outreach",
  APP_URL: "http://localhost:3000",
  JWT_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("parseEnv", () => {
  it("accepts a valid env and applies safe defaults", () => {
    const env = parseEnv(valid);
    expect(env.DRY_RUN).toBe(true);
    expect(env.SENDING_ENABLED).toBe(false);
    expect(env.APP_TIMEZONE).toBe("Asia/Kolkata");
    expect(env.ADMIN_EMAIL).toBeUndefined();
  });

  it("parses true/false strings into booleans", () => {
    const env = parseEnv({ ...valid, DRY_RUN: "false", SENDING_ENABLED: "true" });
    expect(env.DRY_RUN).toBe(false);
    expect(env.SENDING_ENABLED).toBe(true);
  });

  it("treats empty values as not set", () => {
    const env = parseEnv({ ...valid, ADMIN_EMAIL: "", ADMIN_PASSWORD: "" });
    expect(env.ADMIN_EMAIL).toBeUndefined();
    expect(env.ADMIN_PASSWORD).toBeUndefined();
  });

  it("rejects a missing MONGODB_URI", () => {
    expect(() => parseEnv({ ...valid, MONGODB_URI: undefined })).toThrow(/MONGODB_URI/);
  });

  it("rejects a short JWT_SECRET", () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: "too-short" })).toThrow(/JWT_SECRET/);
  });

  it("rejects an ENCRYPTION_KEY that is not 32 bytes", () => {
    const key16 = Buffer.alloc(16, 1).toString("base64");
    expect(() => parseEnv({ ...valid, ENCRYPTION_KEY: key16 })).toThrow(/ENCRYPTION_KEY/);
  });

  it("rejects an unknown timezone", () => {
    expect(() => parseEnv({ ...valid, APP_TIMEZONE: "Mars/Olympus" })).toThrow(/APP_TIMEZONE/);
  });

  it("rejects an invalid DRY_RUN value instead of guessing", () => {
    expect(() => parseEnv({ ...valid, DRY_RUN: "maybe" })).toThrow(/DRY_RUN/);
  });

  it("never includes secret values in the error message", () => {
    const secret = "short-secret-value";
    try {
      parseEnv({ ...valid, JWT_SECRET: secret });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
