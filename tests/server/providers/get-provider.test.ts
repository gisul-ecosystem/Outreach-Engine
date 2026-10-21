import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// getEnv() caches, so each case loads fresh modules after changing the env.
async function loadWith(env: { DRY_RUN: string; SENDING_ENABLED: string }) {
  vi.resetModules();
  vi.stubEnv("DRY_RUN", env.DRY_RUN);
  vi.stubEnv("SENDING_ENABLED", env.SENDING_ENABLED);
  const providers = await import("@/server/providers");
  const { encrypt } = await import("@/server/lib/crypto");
  const connection = {
    _id: "652f0c0c0c0c0c0c0c0c0c0c",
    type: "microsoft",
    tenantId: "contoso.onmicrosoft.com",
    clientId: "00000000-0000-0000-0000-000000000000",
    clientSecretEnc: encrypt(randomBytes(16).toString("hex")),
    updatedAt: new Date(),
  };
  return { ...providers, connection };
}

afterEach(() => vi.unstubAllEnvs());

describe("getProvider + sendingMode (safety rule)", () => {
  it("DRY_RUN=true → FakeProvider, even if SENDING_ENABLED=true", async () => {
    const p = await loadWith({ DRY_RUN: "true", SENDING_ENABLED: "true" });
    expect(p.sendingMode()).toBe("dry-run");
    expect(p.getProvider(p.connection)).toBeInstanceOf(p.FakeProvider);
  });

  it("DRY_RUN=false + SENDING_ENABLED=false → refuses to send", async () => {
    const p = await loadWith({ DRY_RUN: "false", SENDING_ENABLED: "false" });
    expect(p.sendingMode()).toBe("disabled");
    expect(() => p.getProvider(p.connection)).toThrow(/SENDING_ENABLED=false/);
  });

  it("DRY_RUN=false + SENDING_ENABLED=true → real Microsoft provider", async () => {
    const p = await loadWith({ DRY_RUN: "false", SENDING_ENABLED: "true" });
    expect(p.sendingMode()).toBe("live");
    expect(p.getProvider(p.connection)).toBeInstanceOf(p.MicrosoftGraphProvider);
  });

  it("Verify always uses the real provider (it only gets a token, never sends)", async () => {
    const p = await loadWith({ DRY_RUN: "true", SENDING_ENABLED: "false" });
    expect(p.getVerificationProvider(p.connection)).toBeInstanceOf(p.MicrosoftGraphProvider);
  });

  it("rejects Google connections for now", async () => {
    const p = await loadWith({ DRY_RUN: "false", SENDING_ENABLED: "true" });
    expect(() => p.getProvider({ ...p.connection, type: "google" })).toThrow(/Only Microsoft/);
  });
});
