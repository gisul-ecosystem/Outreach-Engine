import { describe, expect, it } from "vitest";
import { emailSchema, isValidEmail, normalizeEmail } from "@/server/lib/email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  John.Doe@Example.COM ")).toBe("john.doe@example.com");
  });
});

describe("isValidEmail", () => {
  it.each(["a@b.co", "first.last+tag@sub.example.com", "  MIXED@Case.com  "])(
    "accepts %s",
    (email) => {
      expect(isValidEmail(email)).toBe(true);
    },
  );

  it.each(["", "plainaddress", "@no-user.com", "no-at-sign.com", "a@b", "a b@c.com", "a@@b.com"])(
    "rejects %j",
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );

  it("rejects emails longer than 254 characters", () => {
    expect(isValidEmail(`${"a".repeat(250)}@b.com`)).toBe(false);
  });
});

describe("emailSchema", () => {
  it("returns the normalized email", () => {
    expect(emailSchema.parse("  Sales@Racko.IN ")).toBe("sales@racko.in");
  });
});
