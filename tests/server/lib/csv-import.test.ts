import { describe, expect, it } from "vitest";
import {
  buildContacts,
  customKey,
  findEmailColumn,
  parseCsv,
  suggestMapping,
} from "@/server/lib/csv-import";

describe("parseCsv", () => {
  it("reads headers and rows, trims values, skips empty lines, handles quotes and a BOM", () => {
    const csv =
      '﻿Email , First Name,Company\n a@b.co ,Ann,"Acme, Inc."\n\n"x@y.co",,"Quote ""Co"""\n';
    const { columns, rows } = parseCsv(csv);
    expect(columns).toEqual(["Email", "First Name", "Company"]);
    expect(rows).toEqual([
      { Email: "a@b.co", "First Name": "Ann", Company: "Acme, Inc." },
      { Email: "x@y.co", "First Name": "", Company: 'Quote "Co"' },
    ]);
  });

  it("fills missing cells with empty strings", () => {
    expect(parseCsv("email,name\na@b.co\n").rows).toEqual([{ email: "a@b.co", name: "" }]);
  });

  it("rejects a file without data rows", () => {
    expect(() => parseCsv("email\n")).toThrow(/no data rows/);
  });

  it("rejects more than 50,000 rows", () => {
    const csv = `email\n${"a@b.co\n".repeat(50_001)}`;
    expect(() => parseCsv(csv)).toThrow(/limit is 50,000/);
  });
});

describe("suggestMapping", () => {
  it("recognises common header names; everything else becomes custom", () => {
    expect(
      suggestMapping(["E-mail", "First Name", "surname", "Organization", "Job Title", "City"]),
    ).toEqual({
      "E-mail": "email",
      "First Name": "firstName",
      surname: "lastName",
      Organization: "company",
      "Job Title": "title",
      City: "custom",
    });
  });

  it("falls back to a column containing 'mail'", () => {
    expect(suggestMapping(["Name", "Contact mail"])["Contact mail"]).toBe("email");
  });

  it("never maps two columns to the same standard field", () => {
    const mapping = suggestMapping(["email", "Email Address"]);
    expect(Object.values(mapping).filter((t) => t === "email")).toHaveLength(1);
  });
});

describe("customKey", () => {
  it.each([
    ["Company Size", "company_size"],
    ["  LinkedIn URL ", "linkedin_url"],
    ["2024 Revenue", "f_2024_revenue"],
    ["$$$", "field"],
    ["a.b$c", "a_b_c"],
  ])("%j → %j", (column, key) => expect(customKey(column)).toBe(key));
});

describe("buildContacts", () => {
  const mapping = {
    Email: "email",
    First: "firstName",
    Company: "company",
    City: "custom",
    Notes: "skip",
  } as const;

  it("normalizes emails, keeps only non-empty values, maps custom columns", () => {
    const result = buildContacts(
      [{ Email: " Ann@Acme.COM ", First: "Ann", Company: "", City: "Pune", Notes: "x" }],
      mapping,
    );
    expect(result.contacts).toEqual([
      { email: "ann@acme.com", firstName: "Ann", custom: { city: "Pune" } },
    ]);
  });

  it("reports invalid rows with spreadsheet row numbers", () => {
    const result = buildContacts(
      [
        { Email: "good@acme.com", First: "", Company: "", City: "", Notes: "" },
        { Email: "not-an-email", First: "", Company: "", City: "", Notes: "" },
        { Email: "", First: "Bob", Company: "", City: "", Notes: "" },
      ],
      mapping,
    );
    expect(result).toMatchObject({ total: 3, invalid: 2 });
    expect(result.contacts).toHaveLength(1);
    expect(result.invalidRows).toEqual([
      { row: 3, email: "not-an-email", reason: "Not a valid email address" },
      { row: 4, email: "", reason: "Email is empty" },
    ]);
  });

  it("dedupes inside the file: first value wins, later rows fill gaps", () => {
    const result = buildContacts(
      [
        { Email: "a@acme.com", First: "Ann", Company: "", City: "", Notes: "" },
        { Email: "A@ACME.com", First: "Annie", Company: "Acme", City: "Pune", Notes: "" },
      ],
      mapping,
    );
    expect(result.duplicatesInFile).toBe(1);
    expect(result.contacts).toEqual([
      { email: "a@acme.com", firstName: "Ann", company: "Acme", custom: { city: "Pune" } },
    ]);
  });

  it("requires an email column in the mapping", () => {
    expect(() => buildContacts([{ A: "x" }], { A: "custom" })).toThrow(/email address/);
  });
});

describe("findEmailColumn", () => {
  it("finds the email column, or uses the only column", () => {
    expect(findEmailColumn(["Name", "Email"])).toBe("Email");
    expect(findEmailColumn(["addresses"])).toBe("addresses");
    expect(() => findEmailColumn(["a", "b"])).toThrow(/"email"/);
  });
});
