import { z } from "zod";

// Empty values in .env.local (e.g. `ADMIN_EMAIL=`) arrive as "" — treat them as "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const isValidTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const isBase64Key32 = (value: string) =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, "must start with mongodb:// or mongodb+srv://"),
    APP_URL: z.url(),
    JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
    ENCRYPTION_KEY: z.string().refine(isBase64Key32, "must be a base64-encoded 32-byte key"),
    APP_TIMEZONE: z
      .string()
      .default("Asia/Kolkata")
      .refine(isValidTimezone, "must be a valid IANA timezone like Asia/Kolkata"),
    DRY_RUN: z.stringbool().default(true),
    SENDING_ENABLED: z.stringbool().default(false),
    ADMIN_EMAIL: optional(z.email()),
    ADMIN_PASSWORD: optional(z.string().min(8, "must be at least 8 characters")),
    // Read-only mailbox reading (Sent Items + replies to hand-sent emails). `npm run simulate` turns it off.
    MAILBOX_READING: z.stringbool().default(true),
    // ---- Click tracking (Phase 10) ----
    /** Start of every tracking link, e.g. https://go.racko.ai → https://go.racko.ai/r/<token>. */
    TRACKING_BASE_URL: z.url().default("http://localhost:3000"),
    /** The only sites a tracking link may lead to (comma-separated host names). */
    TRACKING_ALLOWED_HOSTS: z
      .string()
      .default("racko.ai,www.racko.ai")
      .transform((v) =>
        v
          .split(",")
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean),
      ),
    /** Where unknown links (and any error) send people. Must be https and on the allowed list. */
    TRACKING_FALLBACK_URL: z.url().default("https://racko.ai"),
    /** Secret key that scrambles IP addresses (HMAC) — raw IPs are never stored. */
    TRACKING_IP_SECRET: optional(z.string().min(32, "must be at least 32 characters")),
    /** true only behind Nginx / Cloudflare: then the visitor's IP is read from their headers. */
    TRUST_PROXY: z.stringbool().default(false),
  })
  .superRefine((env, ctx) => {
    const fallback = new URL(env.TRACKING_FALLBACK_URL);
    if (fallback.protocol !== "https:" || !env.TRACKING_ALLOWED_HOSTS.includes(fallback.hostname)) {
      ctx.addIssue({
        code: "custom",
        path: ["TRACKING_FALLBACK_URL"],
        message: "must be an https address whose host is in TRACKING_ALLOWED_HOSTS",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Validates an env object. Error messages name the bad variables but never print their values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables (check .env.local):\n${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Validated env, parsed on first use (not at import time, so `next build` does not need secrets).
 * Next.js loads .env.local itself; the worker and scripts call loadEnvConfig() before this.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
