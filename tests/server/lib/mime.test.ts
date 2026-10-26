import { describe, expect, it } from "vitest";
import {
  buildMimeMessage,
  encodeHeader,
  encodeQuotedPrintable,
  formatAddress,
  newMessageId,
  textToHtml,
} from "@/server/lib/mime";

const decodeQp = (qp: string) =>
  Buffer.from(
    qp
      .replace(/=\r\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
    "latin1",
  ).toString("utf8");

describe("mime helpers", () => {
  it("makes a unique Message-ID on the sender's domain", () => {
    const a = newMessageId("sgoyal@kanonkode.com");
    expect(a).toMatch(/^<[0-9a-f-]{36}@kanonkode\.com>$/);
    expect(newMessageId("sgoyal@kanonkode.com")).not.toBe(a);
  });

  it("quotes display names and encodes non-ASCII ones", () => {
    expect(formatAddress("a@b.co", "Sahil Goyal from Racko")).toBe(
      '"Sahil Goyal from Racko" <a@b.co>',
    );
    expect(formatAddress("a@b.co")).toBe("<a@b.co>");
    expect(formatAddress("a@b.co", "Racko – India")).toMatch(/^=\?UTF-8\?B\?.+\?= <a@b\.co>$/);
  });

  it("encodes non-ASCII subjects (RFC 2047) and never lets a header span lines", () => {
    expect(encodeHeader("GPU servers for Test Co")).toBe("GPU servers for Test Co");
    expect(encodeHeader("Bad\r\nBcc: evil@x.com")).toBe("Bad Bcc: evil@x.com");
    const encoded = encodeHeader("Racko – Oct ₹ plans");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    const decoded = encoded
      .split(/\r\n /)
      .map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ""), "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe("Racko – Oct ₹ plans");
  });

  it("quoted-printable keeps lines ≤ 76 characters and round-trips UTF-8", () => {
    const text = `${"word ".repeat(40)}\nPricing 30%+ — ₹ rupees = fair `;
    const qp = encodeQuotedPrintable(text);
    for (const line of qp.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(decodeQp(qp).replace(/\r\n/g, "\n")).toBe(text);
  });

  it("turns plain text into simple HTML: paragraphs, list, grey opt-out line", () => {
    const html = textToHtml(
      "Hi Ann,\n\nThree reasons:\n\n- Fast\n- Cheap\n\nThanks,\nSam\n\nIf this isn't relevant, just reply \"no\" and I won't email you again.",
    );
    expect(html).toContain('<div style="font-family: Calibri, Arial, sans-serif; font-size: 15px;');
    expect(html).toContain("<p>Hi Ann,</p>");
    expect(html).toContain("<ul><li>Fast</li><li>Cheap</li></ul>");
    expect(html).toContain("<p>Thanks,<br>\nSam</p>");
    expect(html).toContain('<p style="font-size: 12px; color: #888;">');
    expect(textToHtml("a <b> & c")).toContain("a &lt;b&gt; &amp; c");
  });
});

describe("buildMimeMessage", () => {
  const base = {
    from: "sgoyal@kanonkode.com",
    fromName: "Sahil Goyal from Racko",
    to: "lead@example.com",
    subject: "GPU servers in India for Test Co",
    text: "Hi Sandeep,\n\nHello.",
    html: "<p>Hi Sandeep,</p>",
    messageId: "<m1@kanonkode.com>",
    date: new Date("2026-10-21T10:00:00Z"),
    listUnsubscribe: "<mailto:sgoyal@kanonkode.com?subject=unsubscribe>",
  };

  it("has all the headers a normal mail program sends, and both parts", () => {
    const mime = buildMimeMessage(base);
    const [head] = mime.split("\r\n\r\n");
    expect(head).toContain('From: "Sahil Goyal from Racko" <sgoyal@kanonkode.com>');
    expect(head).toContain("To: <lead@example.com>");
    expect(head).toContain("Subject: GPU servers in India for Test Co");
    expect(head).toContain("Date: Wed, 21 Oct 2026 10:00:00 +0000");
    expect(head).toContain("Message-ID: <m1@kanonkode.com>");
    expect(head).toContain('Reply-To: "Sahil Goyal from Racko" <sgoyal@kanonkode.com>');
    expect(head).toContain("List-Unsubscribe: <mailto:sgoyal@kanonkode.com?subject=unsubscribe>");
    expect(head).toContain("MIME-Version: 1.0");
    expect(head).toMatch(/Content-Type: multipart\/alternative; boundary="(.+)"/);
    expect(head).not.toContain("In-Reply-To");

    const boundary = /boundary="(.+)"/.exec(head)![1];
    const parts = mime.split(`--${boundary}`);
    expect(parts).toHaveLength(4); // preamble, text, html, closing "--"
    expect(parts[1]).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(parts[1]).toContain("Content-Transfer-Encoding: quoted-printable");
    expect(parts[2]).toContain("Content-Type: text/html; charset=UTF-8");
    expect(parts[2]).toContain("<p>Hi Sandeep,</p>");
    expect(mime).not.toMatch(/[^\r]\n/); // CRLF line ends only
  });

  it("follow-ups reply in the same thread", () => {
    const mime = buildMimeMessage({ ...base, inReplyTo: "<first@kanonkode.com>" });
    expect(mime).toContain("In-Reply-To: <first@kanonkode.com>");
    expect(mime).toContain("References: <first@kanonkode.com>");
  });
});
