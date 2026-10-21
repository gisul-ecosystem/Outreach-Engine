import { Settings, User } from "@/server/db/models";
import { hashPassword } from "@/server/lib/password";
import { normalizeEmail } from "@/shared/email";

export type SeedResult = {
  admin: "created" | "already-exists";
  settings: "created" | "already-exists";
};

/**
 * Creates the first admin user and the single settings document.
 * Idempotent: anything that already exists is left untouched (an existing admin's password is NOT changed).
 */
export async function seedDatabase(input: {
  adminEmail: string;
  adminPassword: string;
}): Promise<SeedResult> {
  const email = normalizeEmail(input.adminEmail);

  let admin: SeedResult["admin"] = "already-exists";
  if (!(await User.exists({ email }))) {
    await User.create({
      email,
      passwordHash: await hashPassword(input.adminPassword),
      name: "Admin",
      role: "admin",
    });
    admin = "created";
  }

  let settings: SeedResult["settings"] = "already-exists";
  if (!(await Settings.exists({}))) {
    await Settings.create({}); // all values come from the schema defaults
    settings = "created";
  }

  return { admin, settings };
}

/**
 * Sets a new password for an existing user (used when ADMIN_PASSWORD in .env.local was changed after seeding).
 * Returns "not-found" instead of creating a user — run the seed for that.
 */
export async function resetAdminPassword(input: {
  adminEmail: string;
  adminPassword: string;
}): Promise<"updated" | "not-found"> {
  const result = await User.updateOne(
    { email: normalizeEmail(input.adminEmail) },
    { $set: { passwordHash: await hashPassword(input.adminPassword) } },
  );
  return result.matchedCount > 0 ? "updated" : "not-found";
}
