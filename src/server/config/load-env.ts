import { loadEnvConfig } from "@next/env";

/**
 * Loads .env.local (and the other .env files) the same way Next.js does.
 * Only needed outside Next.js: the worker and scripts call this before using getEnv().
 */
export function loadEnv(dir = process.cwd()) {
  loadEnvConfig(dir, process.env.NODE_ENV !== "production");
}
