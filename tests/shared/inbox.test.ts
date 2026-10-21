import { describe, expect, it } from "vitest";
import { createInboxSchema, updateInboxSchema } from "@/shared/inbox";

const base = {
  domainId: "652f0c0c0c0c0c0c0c0c0c0c",
  providerConnectionId: "652f0c0c0c0c0c0c0c0c0c0d",
  email: " Sales@TryRacko.in ",
};
const ok = (extra: object) => createInboxSchema.safeParse({ ...base, ...extra }).success;

describe("inbox limits (Phase 3 rules)", () => {
  it("normalizes the email", () => {
    expect(createInboxSchema.parse(base).email).toBe("sales@tryracko.in");
  });

  it("dailyLimit must be 1–200", () => {
    expect(ok({ dailyLimit: 1 })).toBe(true);
    expect(ok({ dailyLimit: 200 })).toBe(true);
    expect(ok({ dailyLimit: 0 })).toBe(false);
    expect(ok({ dailyLimit: 201 })).toBe(false);
    expect(ok({ dailyLimit: 2.5 })).toBe(false);
  });

  it("minGapSeconds must be at least 30", () => {
    expect(ok({ minGapSeconds: 30, maxGapSeconds: 60 })).toBe(true);
    expect(ok({ minGapSeconds: 29, maxGapSeconds: 60 })).toBe(false);
  });

  it("maxGapSeconds must be >= minGapSeconds", () => {
    expect(ok({ minGapSeconds: 60, maxGapSeconds: 60 })).toBe(true);
    expect(ok({ minGapSeconds: 90, maxGapSeconds: 60 })).toBe(false);
    expect(updateInboxSchema.safeParse({ minGapSeconds: 90, maxGapSeconds: 60 }).success).toBe(
      false,
    );
  });

  it("accepts numbers typed as text (form inputs)", () => {
    expect(createInboxSchema.parse({ ...base, dailyLimit: "15" }).dailyLimit).toBe(15);
  });
});
