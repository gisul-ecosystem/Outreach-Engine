// `npm run tracking:rebuild` — recalculates every contact's engagement (emailed / replied / clicked) and
// every tracking link's click counters from trackedEmails and linkClicks. Safe to run any time.
import { loadEnv } from "@/server/config/load-env";
loadEnv();

import { connectDB, disconnectDB } from "@/server/db/connect";
import { rebuildAllEngagement } from "@/server/services/engagement.service";

async function main() {
  await connectDB();
  const result = await rebuildAllEngagement();
  console.log(
    `Recalculated engagement for ${result.contacts} contact(s) and counters for ${result.links} link(s).`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
