// `npm run admin:reset-password` — sets the admin user's password to ADMIN_PASSWORD from .env.local.
// Use this after changing ADMIN_PASSWORD: `npm run seed` never changes an existing user's password.
import { loadEnv } from "@/server/config/load-env";
import { getEnv } from "@/server/config/env";
import { connectDB, disconnectDB } from "@/server/db/connect";
import { createLogger } from "@/server/lib/logger";
import { resetAdminPassword } from "@/server/services/seed.service";

const log = createLogger("reset-password");

async function main() {
  loadEnv();
  const env = getEnv();
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters) in .env.local first",
    );
  }

  await connectDB();
  const result = await resetAdminPassword({
    adminEmail: env.ADMIN_EMAIL,
    adminPassword: env.ADMIN_PASSWORD,
  });

  if (result === "not-found") {
    throw new Error(`no user with email ${env.ADMIN_EMAIL} — run \`npm run seed\` to create it`);
  }
  log.info(`password updated for ${env.ADMIN_EMAIL} (now matches ADMIN_PASSWORD in .env.local)`);
}

main()
  .catch((err) => {
    log.error("failed", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
