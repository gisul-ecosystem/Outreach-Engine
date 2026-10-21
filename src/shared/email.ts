import { z } from "zod";

/** Trims spaces and lowercases. All emails are stored this way. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** zod schema for an email field: trims, lowercases, then validates (max 254 chars, RFC limit). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export function isValidEmail(email: string): boolean {
  return emailSchema.safeParse(email).success;
}
