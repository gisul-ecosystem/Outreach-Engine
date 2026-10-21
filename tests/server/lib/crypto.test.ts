import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/server/lib/crypto";

const key = randomBytes(32).toString("base64");
const otherKey = randomBytes(32).toString("base64");

describe("crypto (AES-256-GCM)", () => {
  it("round-trips a secret", () => {
    const secret = "my-client-secret~with.symbols_123 ✓";
    const encrypted = encrypt(secret, key);
    expect(encrypted).not.toContain(secret);
    expect(decrypt(encrypted, key)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("fails with the wrong key", () => {
    const encrypted = encrypt("secret", key);
    expect(() => decrypt(encrypted, otherKey)).toThrow(/wrong ENCRYPTION_KEY or tampered/);
  });

  it("fails when the ciphertext was tampered with", () => {
    const [v, iv, tag, data] = encrypt("secret value", key).split(":");
    const bytes = Buffer.from(data, "base64");
    bytes[0] ^= 0xff;
    const tampered = [v, iv, tag, bytes.toString("base64")].join(":");
    expect(() => decrypt(tampered, key)).toThrow(/tampered/);
  });

  it("fails when the auth tag was tampered with", () => {
    const [v, iv, tag, data] = encrypt("secret value", key).split(":");
    const tagBytes = Buffer.from(tag, "base64");
    tagBytes[0] ^= 0x01;
    expect(() => decrypt([v, iv, tagBytes.toString("base64"), data].join(":"), key)).toThrow();
  });

  it("rejects values in an unknown format", () => {
    expect(() => decrypt("not-encrypted", key)).toThrow(/unknown format/);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encrypt("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("does not leak the secret in error messages", () => {
    try {
      decrypt(encrypt("TOP-SECRET", key), otherKey);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("TOP-SECRET");
    }
  });
});
