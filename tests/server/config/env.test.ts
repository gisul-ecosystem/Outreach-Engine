import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env";

const valid = {
  MONGODB_URI: "mongodb://localhost:27017/outreach",
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

  it("click tracking has safe defaults (local links, racko.ai only, no proxy trusted)", () => {
    const env = parseEnv(valid);
    expect(env.MAILBOX_READING).toBe(true);
    expect(env.TRACKING_BASE_URL).toBe("http://localhost:3000");
    expect(env.TRACKING_ALLOWED_HOSTS).toEqual(["racko.ai", "www.racko.ai"]);
    expect(env.TRACKING_FALLBACK_URL).toBe("https://racko.ai");
    expect(env.TRACKING_IP_SECRET).toBeUndefined();
    expect(env.TRUST_PROXY).toBe(false);
  });

  it("reads the allowed hosts as a list", () => {
    const env = parseEnv({ ...valid, TRACKING_ALLOWED_HOSTS: " Racko.ai , go.racko.ai,," });
    expect(env.TRACKING_ALLOWED_HOSTS).toEqual(["racko.ai", "go.racko.ai"]);
  });

  it.each(["http://racko.ai", "https://evil.com"])(
    "rejects a fallback address %s that is not https on an allowed host",
    (url) => {
      expect(() => parseEnv({ ...valid, TRACKING_FALLBACK_URL: url })).toThrow(
        /TRACKING_FALLBACK_URL/,
      );
    },
  );

  it("rejects a short TRACKING_IP_SECRET without printing it", () => {
    expect(() => parseEnv({ ...valid, TRACKING_IP_SECRET: "short-ip-secret" })).toThrow(
      /TRACKING_IP_SECRET/,
    );
    try {
      parseEnv({ ...valid, TRACKING_IP_SECRET: "short-ip-secret" });
    } catch (err) {
      expect((err as Error).message).not.toContain("short-ip-secret");
    }
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
