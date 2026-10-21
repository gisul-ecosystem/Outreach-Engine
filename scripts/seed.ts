// `npm run seed` — creates the admin user (ADMIN_EMAIL / ADMIN_PASSWORD from .env.local) and the settings document.
// Safe to run more than once: existing data is never changed.
import { loadEnv } from "@/server/config/load-env";
import { getEnv } from "@/server/config/env";
import { connectDB, disconnectDB } from "@/server/db/connect";
import { createLogger } from "@/server/lib/logger";
import { seedDatabase } from "@/server/services/seed.service";

const log = createLogger("seed");

async function main() {
  loadEnv();
  const env = getEnv();
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters) in .env.local first",
    );
  }

  await connectDB();
  const result = await seedDatabase({
    adminEmail: env.ADMIN_EMAIL,
    adminPassword: env.ADMIN_PASSWORD,
  });

  log.info(
    result.admin === "created"
      ? `admin user created: ${env.ADMIN_EMAIL}`
      : `admin user already exists: ${env.ADMIN_EMAIL} (password not changed — if you changed ADMIN_PASSWORD, run \`npm run admin:reset-password\`)`,
  );
  log.info(
    result.settings === "created" ? "settings created with defaults" : "settings already exist",
  );
}

main()
  .catch((err) => {
    log.error("failed", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
