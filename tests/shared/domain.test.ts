import { describe, expect, it } from "vitest";
import { createDomainSchema, updateDomainSchema } from "@/shared/domain";

const parse = (name: unknown) => createDomainSchema.safeParse({ name });

describe("domain name validation", () => {
  it.each([
    ["tryracko.in", "tryracko.in"],
    ["  GetRacko.IN ", "getracko.in"],
    ["http://useracko.in", "useracko.in"],
    ["https://www.tryracko.in/about?x=1", "www.tryracko.in"],
    ["mail.sub.example.co.uk", "mail.sub.example.co.uk"],
    ["example.com.", "example.com"],
    ["xn--bcher-kva.example", "xn--bcher-kva.example"],
  ])("accepts %j as %j", (input, expected) => {
    const result = parse(input);
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "localhost",
    "no_underscores.com",
    "-start.com",
    "end-.com",
    "double..dot.com",
    "spaces in.com",
    "user@example.com",
    "example.c",
    "example.123",
    `${"a".repeat(64)}.com`,
  ])("rejects %j", (input) => {
    expect(parse(input).success).toBe(false);
  });

  it("gives a friendly message", () => {
    expect(parse("not a domain").error?.issues[0].message).toBe(
      "Enter a valid domain name, like example.com",
    );
  });
});

describe("updateDomainSchema", () => {
  it("accepts a status change", () => {
    expect(updateDomainSchema.parse({ status: "paused" })).toEqual({ status: "paused" });
  });

  it("rejects an empty update and unknown statuses", () => {
    expect(updateDomainSchema.safeParse({}).success).toBe(false);
    expect(updateDomainSchema.safeParse({ status: "deleted" }).success).toBe(false);
  });
});
