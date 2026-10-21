import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeProvider, ProviderError } from "@/server/providers";

const email = { from: "a@tryracko.in", to: "lead@x.com", subject: "Hi", text: "Hello" };

afterEach(() => vi.restoreAllMocks());

describe("FakeProvider (DRY_RUN)", () => {
  it("pretends to send: logs the email and returns a fake id", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const provider = new FakeProvider({ failureRate: 0, minDelayMs: 0, maxDelayMs: 0 });
    const result = await provider.send(email);
    expect(result.providerMessageId).toMatch(/^fake-/);
    expect(log.mock.calls.flat().join(" ")).toContain("[DRY RUN] not really sent");
  });

  it("fails with a transient error when the dice say so (~3% by default)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new FakeProvider({ minDelayMs: 0, maxDelayMs: 0, random: () => 0.01 });
    await expect(provider.send(email)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "transient",
    });
    await expect(provider.send(email)).rejects.toBeInstanceOf(ProviderError);
  });

  it("succeeds when the random number is above the failure rate", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const provider = new FakeProvider({ minDelayMs: 0, maxDelayMs: 0, random: () => 0.5 });
    await expect(provider.send(email)).resolves.toHaveProperty("providerMessageId");
  });

  it("always verifies OK", async () => {
    const provider = new FakeProvider();
    expect(await provider.verifyConnection()).toEqual({ ok: true });
    expect(await provider.verifyMailbox()).toEqual({ ok: true });
  });
});
