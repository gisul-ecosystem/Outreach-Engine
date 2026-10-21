import { describe, expect, it, vi } from "vitest";
import { checkDomainDns, type DnsResolver } from "@/server/lib/dns-check";

const dnsError = (code: string) => Object.assign(new Error(code), { code });

/** Fake DNS: a map of hostname → answer (or an error code). */
function fakeResolver(answers: {
  mx?: Record<string, { exchange: string; priority: number }[] | string>;
  txt?: Record<string, string[][] | string>;
  cname?: Record<string, string[] | string>;
}): DnsResolver {
  const answer = <T>(table: Record<string, T | string> | undefined, host: string): Promise<T> => {
    const value = table?.[host];
    if (value === undefined) return Promise.reject(dnsError("ENOTFOUND"));
    if (typeof value === "string") return Promise.reject(dnsError(value));
    return Promise.resolve(value);
  };
  return {
    resolveMx: vi.fn((host: string) => answer(answers.mx, host)),
    resolveTxt: vi.fn((host: string) => answer(answers.txt, host)),
    resolveCname: vi.fn((host: string) => answer(answers.cname, host)),
  };
}

const healthy = {
  mx: { "racko.in": [{ exchange: "racko-in.mail.protection.outlook.com", priority: 0 }] },
  txt: {
    "racko.in": [
      ["google-site-verification=abc"],
      ["v=spf1 include:spf.protection.outlook.com -all"],
    ],
    "_dmarc.racko.in": [["v=DMARC1; p=none; rua=mailto:dmarc@racko.in"]],
  },
  cname: {
    "selector1._domainkey.racko.in": ["selector1-racko-in._domainkey.racko.onmicrosoft.com"],
    "selector2._domainkey.racko.in": ["selector2-racko-in._domainkey.racko.onmicrosoft.com"],
  },
};

describe("checkDomainDns", () => {
  it("passes everything for a correctly set up Microsoft 365 domain", async () => {
    const result = await checkDomainDns("racko.in", fakeResolver(healthy));
    expect(result).toMatchObject({ spf: "pass", dkim: "pass", dmarc: "pass", mx: "pass" });
    expect(result.records.spf).toEqual(["v=spf1 include:spf.protection.outlook.com -all"]);
    expect(result.records.mx).toEqual(["0 racko-in.mail.protection.outlook.com"]);
    expect(result.records.dkim).toHaveLength(2);
    expect(result.records.dmarc[0]).toMatch(/^v=DMARC1/);
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  it("joins TXT records that DNS split into several chunks", async () => {
    const result = await checkDomainDns(
      "racko.in",
      fakeResolver({
        ...healthy,
        txt: {
          ...healthy.txt,
          "racko.in": [["v=spf1 include:spf.protection.", "outlook.com -all"]],
        },
      }),
    );
    expect(result.spf).toBe("pass");
  });

  it("fails SPF when Microsoft 365 is not included", async () => {
    const result = await checkDomainDns(
      "racko.in",
      fakeResolver({
        ...healthy,
        txt: { ...healthy.txt, "racko.in": [["v=spf1 include:_spf.google.com ~all"]] },
      }),
    );
    expect(result.spf).toBe("fail");
    expect(result.records.spf).toEqual(["v=spf1 include:_spf.google.com ~all"]);
  });

  it("fails SPF when there are two SPF records (invalid per RFC)", async () => {
    const result = await checkDomainDns(
      "racko.in",
      fakeResolver({
        ...healthy,
        txt: {
          ...healthy.txt,
          "racko.in": [
            ["v=spf1 include:spf.protection.outlook.com -all"],
            ["v=spf1 include:_spf.google.com ~all"],
          ],
        },
      }),
    );
    expect(result.spf).toBe("fail");
  });

  it("fails when records are missing", async () => {
    const result = await checkDomainDns("racko.in", fakeResolver({}));
    expect(result).toMatchObject({ spf: "fail", dkim: "fail", dmarc: "fail", mx: "fail" });
  });

  it("fails DKIM when only one selector exists", async () => {
    const result = await checkDomainDns(
      "racko.in",
      fakeResolver({
        ...healthy,
        cname: { "selector1._domainkey.racko.in": ["selector1-x.onmicrosoft.com"] },
      }),
    );
    expect(result.dkim).toBe("fail");
    expect(result.records.dkim).toEqual(["selector1 → selector1-x.onmicrosoft.com"]);
  });

  it("fails DMARC when the _dmarc TXT is not a DMARC record", async () => {
    const result = await checkDomainDns(
      "racko.in",
      fakeResolver({ ...healthy, txt: { ...healthy.txt, "_dmarc.racko.in": [["hello"]] } }),
    );
    expect(result.dmarc).toBe("fail");
  });

  it("gives 'unknown' (never crashes) when lookups error", async () => {
    const result = await checkDomainDns(
      "racko.in",
      fakeResolver({
        mx: { "racko.in": "ETIMEOUT" },
        txt: { "racko.in": "ESERVFAIL", "_dmarc.racko.in": "ECONNREFUSED" },
        cname: {
          "selector1._domainkey.racko.in": "ETIMEOUT",
          "selector2._domainkey.racko.in": "ETIMEOUT",
        },
      }),
    );
    expect(result).toMatchObject({
      spf: "unknown",
      dkim: "unknown",
      dmarc: "unknown",
      mx: "unknown",
    });
  });

  it("fails a 'null MX' (0 .), which means the domain accepts no email", async () => {
    for (const exchange of ["", "."]) {
      const result = await checkDomainDns(
        "racko.in",
        fakeResolver({ ...healthy, mx: { "racko.in": [{ exchange, priority: 0 }] } }),
      );
      expect(result.mx).toBe("fail");
      expect(result.records.mx[0]).toContain("null MX");
    }
  });

  it("treats an empty MX answer as fail", async () => {
    const result = await checkDomainDns(
      "racko.in",
      fakeResolver({ ...healthy, mx: { "racko.in": [] } }),
    );
    expect(result.mx).toBe("fail");
  });
});
