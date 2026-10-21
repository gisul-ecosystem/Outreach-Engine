// Server entry point for email helpers. The implementation lives in src/shared/email.ts
// so the UI (forms, CSV preview) and the server validate emails exactly the same way.
export { emailSchema, isValidEmail, normalizeEmail } from "@/shared/email";
