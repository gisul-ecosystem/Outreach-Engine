// Spintax: {Hi|Hello|Hey} picks one option per person, so no two emails are word-for-word the same
// (pure: no database, no I/O; used by the renderer and the editor).
//
//   {Hi|Hello|Hey} {{firstName|there}}   → "Hello Priya" for one person, "Hey Rahul" for another
//   {quick |}chat                         → an empty option makes a word optional
//   {Hi {{firstName}}|Hello}              → options may contain {{variables}} and other {a|b} groups
//
// - Only a {…} that contains "|" is spintax: {{variables}} and CSS braces in HTML are left alone.
// - The choice is fixed per person (from their email address), so the preview, a retry and the
//   plain-text + HTML bodies always agree. Group n picks with the same seed everywhere, so a body
//   written twice (text and HTML) with the same groups gets the same words in both.

/** {{ … }} variables are set aside while spintax is resolved (their "|" means a fallback). */
const VARIABLE = /\{\{[^{}]*\}\}/g;
/** An innermost {…} group with at least one "|". */
const GROUP = /\{([^{}]*\|[^{}]*)\}/;
const PLACEHOLDER = /\u0000(\d+)\u0000/g;

/** FNV-1a: a small, stable 32-bit hash (same result on the server and in the browser). */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function protectVariables(template: string) {
  const saved: string[] = [];
  const text = template.replace(VARIABLE, (match) => `\u0000${saved.push(match) - 1}\u0000`);
  return {
    text,
    restore: (s: string) => s.replace(PLACEHOLDER, (_, i: string) => saved[Number(i)]),
  };
}

/** True when the template has at least one {a|b} group. */
export function hasSpintax(template: string): boolean {
  return GROUP.test(protectVariables(template).text);
}

/**
 * Resolves every {a|b|c} group with options picked from `seed` (e.g. the contact's email).
 * Innermost groups first, so nested groups work. {{variables}} are kept for the renderer.
 */
export function resolveSpintax(template: string, seed: string): string {
  return resolveWith(template, (options, n) => hash(`${seed.toLowerCase()}:${n}`) % options.length);
}

/** Every group's FIRST option — the email as written, for checks that read its lines (greeting…). */
export function firstSpinOption(template: string): string {
  return resolveWith(template, () => 0);
}

function resolveWith(template: string, pick: (options: string[], n: number) => number): string {
  const { text, restore } = protectVariables(template);
  let out = text;
  for (let n = 0; GROUP.test(out); n++) {
    out = out.replace(GROUP, (_, body: string) => {
      const options = body.split("|");
      return options[pick(options, n)];
    });
  }
  return restore(out);
}

/** How many different wordings a template can produce (capped, so a huge template stays cheap). */
export function countSpinVersions(template: string, cap = 1_000_000): number {
  const { text } = protectVariables(template);
  // Count from the innermost groups out: a group is worth the sum of its options' versions.
  const values: number[] = [];
  let out = text;
  while (GROUP.test(out)) {
    out = out.replace(GROUP, (_, body: string) => {
      const total = body.split("|").reduce((sum, option) => sum + versionsIn(option, values), 0);
      return `\u0001${values.push(Math.min(total, cap)) - 1}\u0001`;
    });
  }
  return Math.min(versionsIn(out, values), cap);
}

/** Product of the groups (already counted) that appear in this piece of text. */
function versionsIn(text: string, values: number[]): number {
  let product = 1;
  for (const m of text.matchAll(/\u0001(\d+)\u0001/g)) product *= values[Number(m[1])];
  return product;
}

/**
 * Spintax mistakes worth showing in the editor: a "{" without "}" (or the other way round), outside
 * {{variables}}. Plain text only — HTML may hold CSS braces.
 */
export function spintaxProblems(template: string, label = "The email"): string[] {
  const { text } = protectVariables(template);
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) break;
  }
  return depth === 0
    ? []
    : [`${label} has a { without a matching } (or the other way round) — check its {a|b} groups`];
}
