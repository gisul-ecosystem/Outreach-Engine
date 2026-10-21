import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/server/config/env";

// AES-256-GCM: encrypts AND detects tampering (the auth tag fails if anything was changed).
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // recommended IV size for GCM
const VERSION = "v1";

function keyFromBase64(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes (base64-encoded)");
  return key;
}

/**
 * Encrypts a secret. Output format: `v1:<iv>:<authTag>:<ciphertext>` (each part base64).
 * The key defaults to ENCRYPTION_KEY from .env.local.
 */
export function encrypt(plaintext: string, keyBase64: string = getEnv().ENCRYPTION_KEY): string {
  const key = keyFromBase64(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Decrypts a value made by encrypt(). Throws if the key is wrong or the data was changed. */
export function decrypt(payload: string, keyBase64: string = getEnv().ENCRYPTION_KEY): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Encrypted value has an unknown format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = keyFromBase64(keyBase64);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Never include the payload or key in the error.
    throw new Error("Could not decrypt value (wrong ENCRYPTION_KEY or tampered data)");
  }
}
