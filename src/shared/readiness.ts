// "Outlook readiness": checks a campaign email and says, in plain words, what is missing or risky
// (pure: no database, no I/O). The browser runs it live while the email is typed; the server runs the
// same function on Start/Resume and refuses when anything is "error" (Must fix).
//
// Levels: ok · warning (can still start) · error (Must fix: Start/Resume blocked).
// Facts that need the database (how many contacts miss a field, inbox/domain/permission status,
// test send) come from GET /api/campaigns/[id]/readiness and are passed in through `ReadinessContext`.
import { OPT_OUT_LINE, SENDER_VARIABLES, STANDARD_VARIABLES } from "./campaign";
import {
  distinctLinks,
  findShouting,
  findSpamPhrases,
  hasActiveContent,
  hasImage,
  htmlToText,
  OPT_OUT_PATTERN,
  SPAM_REPLACEMENTS,
  URL_PATTERN,
  VARIABLE_PATTERN,
} from "./content-rules";
import { customKey } from "./contact";

export type ReadinessLevel = "ok" | "warning" | "error";
export type ReadinessField = "subjectTemplate" | "bodyTemplate" | "bodyHtml";

/** What the panel can do to help: insert a snippet, replace a word, highlight it, or open a page. */
export type ReadinessFix =
  | {
    kind: "insert";
    label: string;
    field: ReadinessField;
    text: string;
    at: "start" | "end" | "before-opt-out";
  }
  | { kind: "replace"; label: string; field: ReadinessField; find: string; replace: string }
  | { kind: "show"; field: ReadinessField; find: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "send-test" }
  | { kind: "recheck-dns"; domainId: string };

export type ReadinessItem = {
  /** Unique within one result. */
  key: string;
  /** Which rule, e.g. "greeting" (one rule can give several items, e.g. two typos). */
  check: string;
  level: ReadinessLevel;
  /** One short plain-English sentence: what is missing and how to fix it. */
  message: string;
  /** Which version of the email (0 = main); missing = about the whole campaign. */
  template?: number;
  fixes?: ReadinessFix[];
};

export type ReadinessTemplate = {
  name?: string;
  subjectTemplate: string;
  bodyTemplate: string;
  bodyHtml?: string | null;
};

export type ReadinessContext = {
  isFollowUp: boolean;
  /** custom.<key> variables found in the campaign's list; missing = not known yet (not checked). */
  customVariables?: string[];
  /** Domains the campaign sends from, e.g. ["tryracko.in"]. */
  sendingDomains?: string[];
  /** For each variable (canonical name, e.g. "company", "custom.city"): contacts that have it empty. */
  emptyFields?: Record<string, number>;
};

export const MAX_SUBJECT_CHARS = 60;
export const MAX_WORDS = 150;
export const MIN_WORDS = 25;
export const SIGNATURE_SNIPPET = "Best,\n{{senderName}}\n{{senderRole}}";
export const GREETING_SNIPPET = "Hi {{firstName|there}},";
/** Good fallbacks for "Add a fallback" (fields without one get no button). */
const FALLBACKS: Record<string, string> = {
  firstName: "there",
  company: "your team",
  title: "your team",
};
const FIELD_WORDS: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  company: "company",
  title: "job title",
  email: "email",
};

// {{ name }} or {{ name | fallback }} — the same syntax the server's renderer understands.
const VARIABLE = /\{\{\s*([^{}|]*?)\s*(?:\|([^{}]*))?\}\}/g;
const squash = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");
const STANDARD = new Map<string, string>(STANDARD_VARIABLES.map((v) => [squash(v), v]));
const SENDER = new Map<string, string>(SENDER_VARIABLES.map((v) => [squash(v), v]));

const GREETING = /^(hi|hello|hey|dear|good (morning|afternoon|evening)|greetings|namaste|hola)\b/i;
const SIGN_OFF =
  /^(best|regards|kind regards|warm regards|best regards|thanks|thank you|many thanks|cheers|sincerely|talk soon|all the best)\b/i;
const COMPANY_HINT =
  /\b(pvt|private limited|ltd|llc|llp|inc|gmbh|limited|corp|corporation|co\.|technologies|solutions|labs|studio|consulting|software|systems|street|road|avenue|floor|suite|sector|nagar|lane)\b|\b\d{5,6}\b|www\.|\bhttps?:\/\//i;
const FAKE_REPLY = /^\s*(re|fw|fwd|aw|wg)\s*:\s*/i;
const ATTACHMENT =
  /\b(see|find|please find|i'?ve|i have|i'?m sending|have)\s+attached\b|\battached (is|you will find|you'll find|file|pdf|deck|document|brochure|presentation)\b|\b(the|my|an|our) attachment\b/i;
const SHORTENERS =
  /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|tiny\.cc|rb\.gy|t\.ly|s\.id)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const HTML_IN_TEXT =
  /<\/?(p|div|br|span|a|b|strong|i|em|u|ul|ol|li|table|tr|td|h[1-6]|font|img|html|body)\b[^>]*>/i;
const HTML_TAG_NAMES = new Set(
  "p div br span a b i u em strong ul ol li table tr td th h1 h2 h3 h4 h5 h6 img html body head style script font hr small".split(
    " ",
  ),
);
/** Leftovers from a draft: [Name], <company>, XXX, TODO, lorem ipsum, {first_name} (single braces). */
const PLACEHOLDERS = [
  /\[[A-Za-z][A-Za-z0-9 _.'-]{0,30}\]/,
  /<([A-Za-z][A-Za-z _-]{0,30})>/,
  /\b[xX]{3,}\b/,
  /\b(TODO|TBD|FIXME)\b/i,
  /lorem ipsum/i,
  /(?<!\{)\{[A-Za-z_. ]{2,40}\}(?!\})/,
];

/** "first_name", "First Name" and "firstName" are the same variable: its canonical name, or null. */
  export function canonicalVariable(name: string, customVariables?: string[]): string | null {
    const clean = name.trim();
    const standard = STANDARD.get(squash(clean)) ?? SENDER.get(squash(clean));
    if (standard) return standard;
    if (clean.toLowerCase().startsWith("custom.") && clean.length > "custom.".length) {
      return `custom.${customKey(clean.slice("custom.".length))}`;
    }
    if (customVariables) {
      const key = customKey(clean);
      const match = customVariables.find(
        (v) =>
          v.toLowerCase() === `custom.${key}` ||
          v.toLowerCase() === `custom.${clean.toLowerCase()}`,
      );
      if (match) return match;
    }
    return null;
  }

  /** Edit distance (for "Did you mean …?"). */
  function distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const temp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = temp;
      }
    }
    return row[b.length];
  }

  /** firstName written the way the user writes variables (first_name if they use underscores). */
  function inUserStyle(name: string, typed: string): string {
    if (!typed.includes("_") || name.startsWith("custom.")) return name;
    return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  }

  function closest(typed: string, candidates: string[]): string | null {
    const target = squash(typed.replace(/^custom\./i, ""));
    let best: { name: string; d: number } | null = null;
    for (const name of candidates) {
      const d = distance(target, squash(name.replace(/^custom\./i, "")));
      if (!best || d < best.d) best = { name, d };
    }
    return best && best.d <= Math.max(2, Math.floor(target.length / 3)) ? best.name : null;
  }

  const FIELDS: ReadinessField[] = ["subjectTemplate", "bodyTemplate", "bodyHtml"];

  /** The first field (subject, text, HTML) that contains `text`, for "Show me". */
  function fieldWith(t: ReadinessTemplate, text: string): ReadinessField {
    return FIELDS.find((f) => (t[f] ?? "").includes(text)) ?? "bodyTemplate";
  }

  const lines = (text: string) =>
    text
      .replace(/\r\n|\r/g, "\n")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  const wordCount = (text: string) =>
    text.replace(VARIABLE_PATTERN, "x").split(/\s+/).filter(Boolean).length;

  const words = (text: string) =>
    new Set(
      text
        .replace(VARIABLE_PATTERN, " ")
        .toLowerCase()
        .match(/[\p{L}\p{N}']+/gu) ?? [],
    );

  /** All checks for one version of the email. */
  export function checkTemplate(
    t: ReadinessTemplate,
    index: number,
    context: ReadinessContext,
  ): ReadinessItem[] {
    const items: ReadinessItem[] = [];
    const add = (
      check: string,
      level: ReadinessLevel,
      message: string,
      fixes?: ReadinessFix[],
      extra = "",
    ) =>
      items.push({
        key: `${check}:${index}:${extra}`,
        check,
        level,
        message,
        template: index,
        fixes,
      });

    const subject = t.subjectTemplate ?? "";
    const body = t.bodyTemplate ?? "";
    const html = t.bodyHtml ?? "";
    const all = `${subject}\n${body}\n${html}`;

    // ---------- Must fix ----------
    if (!subject.trim()) {
      add(
        "subject",
        "error",
        "Your subject is empty. Write a short, plain subject like a normal email.",
      );
    } else add("subject", "ok", "The subject is filled in.");
    if (!body.trim())
      add("body", "error", "Your email is empty. Write your message in the text box.");
    else add("body", "ok", "The email has text.");

    // {{variables}}: typos, unknown columns, {{originalSubject}} outside a follow-up
    let variableProblems = 0;
    const customBare = (context.customVariables ?? []).map((v) =>
      v.startsWith("custom.") ? v.slice("custom.".length) : v,
    );
    const candidates = [
      ...STANDARD_VARIABLES,
      ...SENDER_VARIABLES.filter((v) => context.isFollowUp || v !== "originalSubject"),
      ...(context.customVariables ?? []),
      ...customBare,
    ];
    const seen = new Set<string>();
    for (const match of all.matchAll(VARIABLE)) {
      const raw = match[0];
      const name = match[1].trim();
      if (seen.has(raw)) continue;
      seen.add(raw);
      const field = fieldWith(t, raw);
      const canonical = name ? canonicalVariable(name, context.customVariables) : null;
      let message: string | null = null;
      let suggestion: string | null = null;
      if (!name) {
        message = `There is an empty ${raw} in your email. Remove it or put a variable name inside.`;
      } else if (canonical === "originalSubject" && !context.isFollowUp) {
        message = "{{originalSubject}} only works in a follow-up. Remove it from this email.";
      } else if (canonical?.startsWith("custom.")) {
        if (context.customVariables && !context.customVariables.includes(canonical)) {
          suggestion = closest(name, context.customVariables);
          message = `No contact in this list has a "${name.slice("custom.".length)}" column, so ${raw} would be empty for everyone.${suggestion ? ` Did you mean {{${suggestion}}}?` : ""}`;
        }
      } else if (!canonical) {
        const best = closest(name, candidates);
        suggestion = best ? inUserStyle(best, name) : null;
        message = `{{${name}}} is not a variable we know.${suggestion ? ` Did you mean {{${suggestion}}}?` : " Use one of the variable buttons above."}`;
      }
      if (!message) continue;
      variableProblems++;
      const fixes: ReadinessFix[] = [{ kind: "show", field, find: raw }];
      if (suggestion) {
        fixes.unshift({
          kind: "replace",
          label: `Use {{${suggestion}}}`,
          field,
          find: raw,
          replace: raw.replace(match[1], suggestion),
        });
      }
      add("variables", "error", message, fixes, raw);
    }
    if (!variableProblems) add("variables", "ok", "Every {{variable}} is spelled correctly.");

    // Leftover placeholders like [Name], <company>, XXX, TODO, lorem ipsum, {first_name}
    const placeholderText = `${subject}\n${body}\n${htmlToText(html)}`.replace(VARIABLE_PATTERN, " ");
    let placeholders = 0;
    for (const pattern of PLACEHOLDERS) {
      // A real HTML tag like <p> is not a placeholder (HTML in the text box has its own warning).
      const found = [
        ...placeholderText.matchAll(new RegExp(pattern.source, `${pattern.flags}g`)),
      ].find((m) => !(m[0].startsWith("<") && HTML_TAG_NAMES.has(m[1]?.toLowerCase() ?? "")));
      if (!found) continue;
      placeholders++;
      const single = found[0].startsWith("{");
      add(
        "placeholders",
        "error",
        single
          ? `"${found[0]}" has single braces, so it would be sent as it is. Use double braces: {${found[0]}}.`
          : `Your email still has the placeholder "${found[0]}". Replace it with real text or a variable like {{firstName}}.`,
        [
          single
            ? {
              kind: "replace",
              label: `Change to {${found[0]}}`,
              field: fieldWith(t, found[0]),
              find: found[0],
              replace: `{${found[0]}}`,
            }
            : { kind: "show", field: fieldWith(t, found[0]), find: found[0] },
        ],
        found[0],
      );
    }
    if (!placeholders) add("placeholders", "ok", "No leftover placeholders like [Name] or TODO.");

    // A first email that pretends to be a reply
    const fakeReply = !context.isFollowUp ? FAKE_REPLY.exec(subject) : null;
    if (fakeReply) {
      add(
        "fake-reply",
        "error",
        `Your subject starts with "${fakeReply[0].trim()}" but this is a first email. Microsoft treats fake replies as deceptive — remove it.`,
        [
          {
            kind: "replace",
            label: `Remove "${fakeReply[0].trim()}"`,
            field: "subjectTemplate",
            find: fakeReply[0],
            replace: "",
          },
        ],
      );
    } else if (!context.isFollowUp)
      add("fake-reply", "ok", 'The subject does not pretend to be a reply ("RE:").');

    // Links, images, attachments, shorteners, scripts
    let risky = 0;
    const links = distinctLinks(t);
    if (links.length > 1) {
      risky++;
      add(
        "links-images",
        "error",
        `Your email has ${links.length} different links. Keep at most one link in a cold email.`,
        [{ kind: "show", field: fieldWith(t, links[1].split("/")[0]), find: links[1].split("/")[0] }],
        "links",
      );
    }
    if (hasImage(html)) {
      risky++;
      add(
        "links-images",
        "error",
        "Your HTML version has an image. Remove it — images and tracking pixels hurt delivery.",
        [{ kind: "show", field: "bodyHtml", find: "<img" }],
        "image",
      );
    }
    const attachment = ATTACHMENT.exec(`${body}\n${htmlToText(html)}`);
    if (attachment) {
      risky++;
      add(
        "links-images",
        "error",
        `Your email says "${attachment[0]}", but no file is ever attached. Remove that sentence.`,
        [{ kind: "show", field: fieldWith(t, attachment[0]), find: attachment[0] }],
        "attachment",
      );
    }
    const shortener = SHORTENERS.exec(`${body}\n${html}`);
    if (shortener) {
      risky++;
      add(
        "links-images",
        "error",
        `Short links like ${shortener[0]} are a strong spam signal. Use the full address of your own website.`,
        [{ kind: "show", field: fieldWith(t, shortener[0]), find: shortener[0] }],
        "shortener",
      );
    }
    if (hasActiveContent(html)) {
      risky++;
      add(
        "links-images",
        "error",
        "Your HTML version has a form, script or embedded frame. Remove it — email programs block these.",
        [
          {
            kind: "show",
            field: "bodyHtml",
            find: /<(form|script|iframe|video|object)/i.exec(html)?.[0] ?? "<",
          },
        ],
        "active",
      );
    }
    if (!risky) add("links-images", "ok", "At most one link, no images, no attachment talk.");

    // Spam wording (these blocked Start before this panel existed, so they stay "Must fix")
    const visible = `${subject}\n${body}\n${htmlToText(html)}`.replace(VARIABLE_PATTERN, " ");
    let spammy = 0;
    for (const { phrase, found } of findSpamPhrases(visible)) {
      spammy++;
      const plain = SPAM_REPLACEMENTS[phrase as keyof typeof SPAM_REPLACEMENTS];
      const field = fieldWith(t, found);
      add(
        "spam-words",
        "error",
        `"${found}" is a spam-trigger word. Say it plainly, e.g. "${plain}".`,
        [{ kind: "replace", label: `Replace with "${plain}"`, field, find: found, replace: plain }],
        phrase,
      );
    }
    for (const word of findShouting(visible)) {
      spammy++;
      const calm = word[0] + word.slice(1).toLowerCase();
      add(
        "spam-words",
        "error",
        `"${word}" is in capital letters, which reads as shouting. Write it as "${calm}".`,
        [
          {
            kind: "replace",
            label: `Change to "${calm}"`,
            field: fieldWith(t, word),
            find: word,
            replace: calm,
          },
        ],
        word,
      );
    }
    const bangs = /!{2,}/.exec(visible);
    if (bangs) {
      spammy++;
      add(
        "spam-words",
        "error",
        'Use at most one exclamation mark — "!!" looks like spam.',
        [
          {
            kind: "replace",
            label: 'Change to "!"',
            field: fieldWith(t, bangs[0]),
            find: bangs[0],
            replace: "!",
          },
        ],
        "bangs",
      );
    }
    if (!spammy) add("spam-words", "ok", 'No spam words, no shouting in capitals, no "!!".');

    // ---------- Warnings ----------
    const bodyLines = lines(body);
    const optOutIndex = bodyLines.findIndex((l) => OPT_OUT_PATTERN.test(l));
    const beforeOptOut = optOutIndex >= 0 ? bodyLines.slice(0, optOutIndex) : bodyLines;

    if (body.trim()) {
      if (!GREETING.test(bodyLines[0] ?? "")) {
        add(
          "greeting",
          "warning",
          `Your email doesn't start with a greeting. Start with something like "${GREETING_SNIPPET}"`,
          [
            {
              kind: "insert",
              label: "Add it",
              field: "bodyTemplate",
              text: `${GREETING_SNIPPET}\n\n`,
              at: "start",
            },
          ],
        );
      } else add("greeting", "ok", "It starts with a greeting.");

      const tail = beforeOptOut.slice(-6);
      const signed =
        tail.some((l) => SIGN_OFF.test(l)) || /\{\{\s*sender_?name/i.test(tail.join("\n"));
      if (!signed) {
        add(
          "signature",
          "warning",
          "Your email has no sign-off with your name. Add a signature like: Best, {{senderName}}",
          [
            {
              kind: "insert",
              label: "Add it",
              field: "bodyTemplate",
              text: SIGNATURE_SNIPPET,
              at: "before-opt-out",
            },
          ],
        );
      } else add("signature", "ok", "It ends with a sign-off.");

      if (!OPT_OUT_PATTERN.test(body)) {
        add("opt-out", "warning", `Your email has no opt-out line. Add one like: "${OPT_OUT_LINE}"`, [
          { kind: "insert", label: "Add it", field: "bodyTemplate", text: OPT_OUT_LINE, at: "end" },
        ]);
      } else add("opt-out", "ok", "It has an opt-out line.");
      if (html.trim() && !OPT_OUT_PATTERN.test(htmlToText(html))) {
        add(
          "opt-out",
          "warning",
          "Your HTML version has no opt-out line. Add the same line as in the text.",
          [
            {
              kind: "insert",
              label: "Add it",
              field: "bodyHtml",
              text: `<p>${OPT_OUT_LINE}</p>`,
              at: "end",
            },
          ],
          "html",
        );
      }

      const signature = beforeOptOut.slice(-8).join("\n");
      const domainLabels = (context.sendingDomains ?? []).flatMap((d) => [d, d.split(".")[0]]);
      const hasCompany =
        COMPANY_HINT.test(signature) ||
        domainLabels.some((d) => d.length >= 3 && signature.toLowerCase().includes(d.toLowerCase()));
      if (!hasCompany) {
        add(
          "company",
          "warning",
          "Your signature has no company name or postal address. Add them under your name — many countries require this for business email.",
        );
      } else add("company", "ok", "The signature has your company or address.");

      const count = wordCount(optOutIndex >= 0 ? beforeOptOut.join("\n") : body);
      if (count > MAX_WORDS) {
        add(
          "length",
          "warning",
          `Your email is ${count} words. Cold emails work best under ${MAX_WORDS} — try to shorten it.`,
        );
      } else if (count < MIN_WORDS) {
        add(
          "length",
          "warning",
          `Your email is only ${count} words. Add a sentence or two so it reads like a real note (${MIN_WORDS}+ words).`,
        );
      } else add("length", "ok", `Good length (${count} words).`);
    }

    if (subject.trim()) {
      const length = subject.replace(VARIABLE_PATTERN, "xxxxxxxx").length;
      const emoji = EMOJI.exec(subject);
      if (length > MAX_SUBJECT_CHARS) {
        add(
          "subject-style",
          "warning",
          `Your subject is long (about ${length} characters). Keep it under ${MAX_SUBJECT_CHARS} so it isn't cut off.`,
          [{ kind: "show", field: "subjectTemplate", find: subject }],
          "long",
        );
      }
      if (emoji) {
        add(
          "subject-style",
          "warning",
          "Your subject has an emoji. Plain subjects look like normal person-to-person email.",
          [
            {
              kind: "replace",
              label: "Remove it",
              field: "subjectTemplate",
              find: emoji[0],
              replace: "",
            },
          ],
          "emoji",
        );
      }
      if (length <= MAX_SUBJECT_CHARS && !emoji) add("subject-style", "ok", "Short, plain subject.");
    }

    // Links: own domain, short and clean
    let linkWarnings = 0;
    const domains = (context.sendingDomains ?? []).map((d) => d.toLowerCase());
    for (const url of new Set(`${body}\n${html}`.match(URL_PATTERN) ?? [])) {
      const host = url
        .replace(/^https?:\/\//i, "")
        .split(/[/?#:]/)[0]
        .toLowerCase()
        .replace(/^www\./, "");
      const field = fieldWith(t, url);
      if (domains.length && !domains.some((d) => host === d || host.endsWith(`.${d}`))) {
        linkWarnings++;
        add(
          "link-domain",
          "warning",
          `The link to ${host} goes to a different website than the one you send from (${domains.join(", ")}). Links to your own domain look more trustworthy.`,
          [{ kind: "show", field, find: url }],
          url,
        );
      }
      if (url.length > 60 || url.includes("?")) {
        linkWarnings++;
        add(
          "link-domain",
          "warning",
          "This link is long and looks machine-made. Use a short, clean address like yourdomain.com/demo.",
          [{ kind: "show", field, find: url }],
          `long:${url}`,
        );
      }
    }
    if (!linkWarnings) add("link-domain", "ok", "Links (if any) are short and on your own domain.");

    // Variables without a fallback that some contacts don't have
    let gaps = 0;
    const reported = new Set<string>();
    for (const match of all.matchAll(VARIABLE)) {
      const hasFallback = match[2] !== undefined;
      const canonical = canonicalVariable(match[1]);
      if (hasFallback || !canonical || reported.has(canonical)) continue;
      const empty = context.emptyFields?.[canonical] ?? 0;
      if (empty <= 0) continue;
      reported.add(canonical);
      gaps++;
      const what = FIELD_WORDS[canonical] ?? `"${canonical.replace(/^custom\./, "")}"`;
      const fallback = FALLBACKS[canonical];
      const raw = match[0];
      add(
        "fallbacks",
        "warning",
        `${empty.toLocaleString()} contact${empty === 1 ? " has" : "s have"} no ${what} — they will be skipped. Add a fallback like {{${match[1].trim()}|${fallback ?? "…"}}}.`,
        fallback
          ? [
            {
              kind: "replace",
              label: `Use {{${match[1].trim()}|${fallback}}}`,
              field: fieldWith(t, raw),
              find: raw,
              replace: `{{${match[1].trim()}|${fallback}}}`,
            },
          ]
          : [{ kind: "show", field: fieldWith(t, raw), find: raw }],
        canonical,
      );
    }
    if (!gaps && context.emptyFields)
      add("fallbacks", "ok", "Every contact has the fields this email uses.");

    // Plain text vs HTML
    const tag = HTML_IN_TEXT.exec(body);
    if (tag) {
      add(
        "text-vs-html",
        "warning",
        `Your plain-text email contains HTML code (${tag[0]}). Put HTML in the "own HTML version" box instead.`,
        [{ kind: "show", field: "bodyTemplate", find: tag[0] }],
        "tags",
      );
    } else if (html.trim() && body.trim()) {
      const textWords = words(body);
      const htmlWords = words(htmlToText(html));
      const shared = [...textWords].filter((w) => htmlWords.has(w)).length;
      const similar = shared / Math.max(1, Math.max(textWords.size, htmlWords.size));
      if (similar < 0.7) {
        add(
          "text-vs-html",
          "warning",
          "Your HTML version says something different from the plain text. Keep both the same — some people see the text version.",
        );
      } else add("text-vs-html", "ok", "The HTML version matches the text.");
    } else if (body.trim()) add("text-vs-html", "ok", "Plain text without HTML code.");

    // Follow-up subject
    if (context.isFollowUp && subject.trim()) {
      if (!/^\s*(re:\s*)?\{\{\s*original_?subject\s*\}\}\s*$/i.test(subject)) {
        add(
          "follow-up-subject",
          "warning",
          'In a follow-up, Microsoft sets the subject to "RE: <first email\'s subject>" itself. Use {{originalSubject}} as the subject so it matches.',
          [
            {
              kind: "replace",
              label: "Use {{originalSubject}}",
              field: "subjectTemplate",
              find: subject,
              replace: "{{originalSubject}}",
            },
          ],
        );
      } else add("follow-up-subject", "ok", "The follow-up keeps the first email's subject.");
    }
    return items;
  }

  /** Every version of the campaign email. Index 0 is the main one, then the extra versions. */
  export function checkCampaignContent(
    templates: ReadinessTemplate[],
    context: ReadinessContext,
  ): ReadinessItem[] {
    return templates.flatMap((t, i) => checkTemplate(t, i, context));
  }

  /** A sending inbox, as far as readiness is concerned. */
  export type ReadinessInbox = {
    id: string;
    email: string;
    displayName: string;
    senderName: string;
    senderRole: string;
    status: string;
    /** Its Microsoft connection; null = none linked. */
    connectionId: string | null;
  };

  const usesVariable = (templates: ReadinessTemplate[], name: string) =>
    templates.some((t) =>
      [...`${t.subjectTemplate}\n${t.bodyTemplate}\n${t.bodyHtml ?? ""}`.matchAll(VARIABLE)].some(
        (m) => squash(m[1]) === squash(name),
      ),
    );

  /**
   * 7. Every inbox must have the signature values the email uses ({{senderName}}, {{senderRole}}):
   * Must fix when used and empty; a gentle warning when empty but not used yet.
   */
  export function checkSenders(
    templates: ReadinessTemplate[],
    inboxes: ReadinessInbox[],
  ): ReadinessItem[] {
    const items: ReadinessItem[] = [];
    const usesName = usesVariable(templates, "senderName");
    const usesRole = usesVariable(templates, "senderRole");
    const editInbox: ReadinessFix = { kind: "link", label: "Edit inbox", href: "/inboxes" };
    for (const inbox of inboxes) {
      const name = inbox.senderName || inbox.displayName;
      const missing = [!name ? "name" : null, !inbox.senderRole ? "role" : null].filter(Boolean);
      const blocking = (!name && usesName) || (!inbox.senderRole && usesRole);
      if (missing.length === 0) continue;
      items.push({
        key: `sender:${inbox.id}`,
        check: "sender",
        level: blocking ? "error" : "warning",
        message: blocking
          ? `Your email uses ${[!name && usesName ? "{{senderName}}" : null, !inbox.senderRole && usesRole ? "{{senderRole}}" : null].filter(Boolean).join(" and ")}, but the inbox ${inbox.email} has no ${missing.join(" or ")} filled in. Edit the inbox and add them.`
          : `The inbox ${inbox.email} has no signature ${missing.join(" or ")} yet. Fill it in so your sign-off can use it.`,
        fixes: [editInbox],
      });
    }
    if (inboxes.length && !items.length) {
      items.push({
        key: "sender:ok",
        check: "sender",
        level: "ok",
        message: "Every inbox has its signature name and role.",
      });
    }
    return items;
  }

  /** Facts from the database for the setup checks (GET /api/campaigns/[id]/readiness). */
  export type ReadinessFacts = {
    inboxes: ReadinessInbox[];
    domains: {
      id: string;
      name: string;
      dns: { spf: string; dkim: string; dmarc: string; mx: string };
    }[];
    connections: {
      id: string;
      name: string;
      status: string;
      /** null = not verified since this check existed */
      grantedPermissions: string[] | null;
    }[];
    testSentAt: string | null;
  };

  /** 18–21: inboxes, DNS of the sending domains, the Mail.Read permission, a test email to yourself. */
  export function checkSetup(facts: ReadinessFacts): ReadinessItem[] {
    const items: ReadinessItem[] = [];
    const add = (
      key: string,
      check: string,
      level: ReadinessLevel,
      message: string,
      fixes?: ReadinessFix[],
    ) => items.push({ key, check, level, message, fixes });
    const connections = new Map(facts.connections.map((c) => [c.id, c]));

    // 18. inboxes
    for (const inbox of facts.inboxes) {
      const connection = inbox.connectionId ? connections.get(inbox.connectionId) : undefined;
      const problems: string[] = [];
      if (inbox.status !== "active") {
        problems.push(
          `The inbox ${inbox.email} is ${inbox.status}, so it will not send. Resume it on the Inboxes page.`,
        );
      }
      if (!connection) {
        problems.push(
          `The inbox ${inbox.email} has no Microsoft connection. Edit the inbox and choose one.`,
        );
      } else if (connection.status !== "connected") {
        problems.push(
          `The Microsoft connection "${connection.name}" is not Connected yet. Press Verify on the Providers page.`,
        );
      }
      if (!inbox.displayName) {
        problems.push(
          `The inbox ${inbox.email} has no display name. Set it in Microsoft 365 (that name is what people see) and in Inboxes → Edit.`,
        );
      }
      problems.forEach((message, i) =>
        add(`inbox:${inbox.id}:${i}`, "inbox-setup", "warning", message, [
          message.includes("Providers")
            ? { kind: "link", label: "Open Providers", href: "/providers" }
            : { kind: "link", label: "Edit inbox", href: "/inboxes" },
        ]),
      );
      if (!problems.length)
        add(`inbox:${inbox.id}`, "inbox-setup", "ok", `The inbox ${inbox.email} is ready.`);
    }

    // 19. DNS of each sending domain
    for (const domain of facts.domains) {
      const names = { spf: "SPF", dkim: "DKIM", dmarc: "DMARC", mx: "MX" } as const;
      const failed = (Object.keys(names) as (keyof typeof names)[]).filter(
        (k) => domain.dns[k] === "fail",
      );
      const unknown = (Object.keys(names) as (keyof typeof names)[]).filter(
        (k) => domain.dns[k] === "unknown",
      );
      const recheck: ReadinessFix[] = [{ kind: "recheck-dns", domainId: domain.id }];
      if (failed.length) {
        add(
          `dns:${domain.id}`,
          "domain-dns",
          "error",
          `The domain ${domain.name} fails its ${failed.map((k) => names[k]).join(", ")} check, so Microsoft and Gmail may reject its emails. Fix the DNS records, then re-check.`,
          recheck,
        );
      } else if (unknown.length) {
        add(
          `dns:${domain.id}`,
          "domain-dns",
          "warning",
          `The DNS of ${domain.name} has not been checked yet (${unknown.map((k) => names[k]).join(", ")}). Press Re-check DNS.`,
          recheck,
        );
      } else
        add(
          `dns:${domain.id}`,
          "domain-dns",
          "ok",
          `${domain.name}: SPF, DKIM, DMARC and MX all pass.`,
        );
    }

    // 20. Mail.Read (bounces, replies, Message-IDs)
    for (const connection of facts.connections) {
      const perms = connection.grantedPermissions;
      const link: ReadinessFix[] = [{ kind: "link", label: "Open Providers", href: "/providers" }];
      if (perms === null) {
        add(
          `mail-read:${connection.id}`,
          "mail-read",
          "warning",
          `We don't know yet if bounces and replies can be detected for "${connection.name}". Press Verify on the Providers page.`,
          link,
        );
      } else if (!perms.some((p) => p === "Mail.Read" || p === "Mail.ReadWrite")) {
        add(
          `mail-read:${connection.id}`,
          "mail-read",
          "warning",
          `Bounces and replies won't be detected: "${connection.name}" is missing the Mail.Read permission in Microsoft.`,
          link,
        );
      } else
        add(
          `mail-read:${connection.id}`,
          "mail-read",
          "ok",
          `"${connection.name}" can detect bounces and replies.`,
        );
    }

    // 21. a test email to yourself
    if (!facts.testSentAt) {
      add(
        "test-sent",
        "test-sent",
        "warning",
        "You haven't sent yourself a test of this campaign yet. Send one and check how it looks.",
        [{ kind: "send-test" }],
      );
    } else add("test-sent", "test-sent", "ok", "A test email of this campaign was sent.");
    return items;
  }

  export type ReadinessSummary = { passed: number; total: number; errors: number; warnings: number };

  /** "7 of 9 checks passed": a rule passes for a version when it has no warning or error there. */
  export function summarize(items: ReadinessItem[]): ReadinessSummary {
    const groups = new Map<string, ReadinessLevel[]>();
    for (const item of items) {
      const key = `${item.check}:${item.template ?? "-"}`;
      groups.set(key, [...(groups.get(key) ?? []), item.level]);
    }
    return {
      passed: [...groups.values()].filter((levels) => levels.every((l) => l === "ok")).length,
      total: groups.size,
      errors: items.filter((i) => i.level === "error").length,
      warnings: items.filter((i) => i.level === "warning").length,
    };
  }

  /**
   * Must-fix items as sentences for an error message (server: Start/Resume refuse with these).
   * With several versions each sentence names its version.
   */
  export function mustFixMessages(items: ReadinessItem[], templates: ReadinessTemplate[]): string[] {
    return items
      .filter((i) => i.level === "error")
      .map((i) =>
        templates.length > 1 && i.template !== undefined
          ? `"${templates[i.template]?.name || `Version ${i.template + 1}`}": ${i.message}`
          : i.message,
      );
  }

  /** What GET /api/campaigns/[id]/readiness returns. */
  export type CampaignReadinessDTO = {
    /** For the live content checks in the browser. */
    context: ReadinessContext;
    /** For the live signature check (7). */
    inboxes: ReadinessInbox[];
    /** 18–21, from the database. */
    setup: ReadinessItem[];
    /** The saved email checked on the server: content + signatures (what Start/Resume enforce). */
    saved: ReadinessItem[];
    testSentAt: string | null;
  };

  /**
   * Applies a fix to a text: insert a snippet (start / end / just above the opt-out line) or replace
   * the first occurrence of a word. Used by the "Add it" buttons.
   */
  export function applyFix(value: string, fix: ReadinessFix): string {
    if (fix.kind === "replace") {
      const at = value.indexOf(fix.find);
      return at < 0 ? value : value.slice(0, at) + fix.replace + value.slice(at + fix.find.length);
    }
    if (fix.kind !== "insert") return value;
    if (fix.at === "start") return `${fix.text}${value.replace(/^\s+/, "")}`;
    if (fix.at === "end") return `${value.trimEnd()}\n\n${fix.text}`;
    // Just above the opt-out line (if there is one), otherwise at the end.
    const all = value.replace(/\r\n|\r/g, "\n").split("\n");
    const index = all.findIndex((l) => OPT_OUT_PATTERN.test(l));
    if (index < 0) return `${value.trimEnd()}\n\n${fix.text}`;
    const before = all.slice(0, index).join("\n").trimEnd();
    return `${before}\n\n${fix.text}\n\n${all.slice(index).join("\n")}`;
  }
