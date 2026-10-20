import path from "node:path";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { noServerInClient } from "../../eslint-rules/no-server-in-client.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const file = (relative: string) => path.join(process.cwd(), relative);

ruleTester.run("no-server-in-client", noServerInClient, {
  valid: [
    // Server code may import server code.
    { code: 'import { ok } from "@/server/lib/api";', filename: file("src/app/api/x/route.ts") },
    // Client files may import shared code.
    { code: '"use client";\nimport { a } from "@/shared/x";', filename: file("src/app/page.tsx") },
    // "use client" written later in the file is not a directive.
    {
      code: 'import { ok } from "@/server/lib/api";\n"use client";',
      filename: file("src/app/page.tsx"),
    },
  ],
  invalid: [
    {
      code: '"use client";\nimport { getEnv } from "@/server/config/env";',
      filename: file("src/app/page.tsx"),
      errors: [{ messageId: "forbidden" }],
    },
    {
      code: '"use client";\nimport { ok } from "../server/lib/api";',
      filename: file("src/app/page.tsx"),
      errors: [{ messageId: "forbidden" }],
    },
    {
      code: '"use client";\nconst m = import("@/server/db/connect");',
      filename: file("src/app/page.tsx"),
      errors: [{ messageId: "forbidden" }],
    },
    {
      code: 'export { ok } from "@/server/lib/api";',
      filename: file("src/components/foo.tsx"),
      options: [{ always: true }],
      errors: [{ messageId: "forbidden" }],
    },
  ],
});
