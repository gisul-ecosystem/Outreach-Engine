import type { NextConfig } from "next";

// cacheComponents is intentionally OFF: CLAUDE.md requires `export const runtime = "nodejs"`
// in every route handler, which Cache Components does not allow. Our data is live
// (dashboard, queue), so we want every API request to run fresh anyway.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
