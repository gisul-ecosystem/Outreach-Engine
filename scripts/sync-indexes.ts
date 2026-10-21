// `npm run db:indexes` — makes the MongoDB indexes match the model definitions (BUILD_PLAN section 4).
// Creates missing indexes and removes ones that are no longer defined. Safe to run any time.
import { loadEnv } from "@/server/config/load-env";
import { connectDB, disconnectDB } from "@/server/db/connect";
import { allModels } from "@/server/db/models";
import { createLogger } from "@/server/lib/logger";

const log = createLogger("db:indexes");

async function main() {
  loadEnv();
  await connectDB();

  for (const model of allModels) {
    const dropped = await model.syncIndexes();
    const indexes = await model.listIndexes();
    const names = indexes.map((index) => index.name).join(", ");
    const droppedNote = dropped.length ? ` (removed old: ${dropped.join(", ")})` : "";
    log.info(`${model.collection.collectionName}: ${names}${droppedNote}`);
  }

  log.info("all indexes are in sync");
}

main()
  .catch((err) => {
    log.error("failed", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
