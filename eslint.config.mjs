import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import localRules from "./eslint-rules/no-server-in-client.mjs";

const SERVER_IMPORT_MESSAGE =
  "src/server is server-only. Client code must call the API (/api/...) instead.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Turn off ESLint style rules that would fight with Prettier (Prettier owns formatting).
  prettier,

  // Safety rule: browser code must never import server code (DB models, secrets, providers).
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    plugins: { local: localRules },
    rules: {
      // Any file that starts with "use client"
      "local/no-server-in-client": "error",
    },
  },
  {
    files: ["src/components/**", "src/lib/client/**"],
    rules: {
      // Every file in these folders, with or without "use client"
      "local/no-server-in-client": ["error", { always: true }],
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/server", "@/server/*"], message: SERVER_IMPORT_MESSAGE }] },
      ],
    },
  },

  // The proxy (src/proxy.ts) runs before every request: JWT checks with jose only, never the database.
  {
    files: ["src/proxy.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "mongoose", message: "proxy.ts must not use the database." }],
          patterns: [
            {
              group: ["@/server/db", "@/server/db/*", "@/server/services/*", "@/server/lib/api"],
              message: "proxy.ts may only use jose (via @/server/lib/auth), never the database.",
            },
          ],
        },
      ],
    },
  },

  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
