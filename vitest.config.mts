import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Every database test file starts its own in-memory MongoDB (hundreds of MB of disk each);
    // running them all at once fills small disks, so limit how many run in parallel.
    maxWorkers: 3,
    include: ["tests/**/*.test.ts"],
    // Database tests start an in-memory MongoDB; the first run downloads it, which can take a while.
    hookTimeout: 180_000,
    // Fake, test-only values so getEnv() works in tests. Never the real .env.local secrets.
    env: {
      MONGODB_URI: "mongodb://127.0.0.1:1/unused-in-tests",
      APP_URL: "http://localhost:3000",
      JWT_SECRET: "test-only-jwt-secret-that-is-long-enough-123",
      ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
  },
});
