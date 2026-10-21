import { z } from "zod";
import { emailSchema } from "./email";
import type { UserRole } from "./enums";

/** Login form + POST /api/auth/login body. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(200, "Password is too long"),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** The signed-in user as returned by the API (never includes the password hash). */
export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};
