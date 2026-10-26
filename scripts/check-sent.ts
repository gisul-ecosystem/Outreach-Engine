// `npm run sent:check` — reads every attached inbox's Sent Items once now (the worker also does it every
// 5 minutes) and prints how many emails were sent by hand / by the engine today, this week and this month.
// Read-only towards Microsoft: works in DRY_RUN too. Needs the Mail.Read application permission.
import { loadEnv } from "@/server/config/load-env";
loadEnv();

import { connectDB, disconnectDB } from "@/server/db/connect";
import { Event } from "@/server/db/models";
import { sentItemsTick } from "@/server/scheduler/sent-items";
import { getTrackedStats } from "@/server/services/tracked-email.service";

async function main() {
  await connectDB();
  const startedAt = new Date();
  const result = await sentItemsTick();
  console.log(
    `Read ${result.inboxes} inbox(es): ${result.manual} new email(s) sent by hand, ${result.engine} by the engine, ` +
      `${result.replies} new repl(ies) (${result.optOuts} "no thanks").`,
  );
  const failures = await Event.find({
    type: "sentitems.read_failed",
    createdAt: { $gte: startedAt },
  })
    .select("message")
    .lean();
  for (const f of failures) console.log(`  ! ${f.message}`);

  for (const source of ["manual", "engine"] as const) {
    const stats = await getTrackedStats({ source, period: "day", count: 1 });
    const line = (name: string, c: { emails: number; people: number }) =>
      `${name} ${c.emails} email(s) to ${c.people} people`;
    console.log(
      `\n${source === "manual" ? "Sent by hand" : "Sent by the engine"} (${stats.timezone}):\n  ` +
        [
          line("today:", stats.today),
          line("this week:", stats.thisWeek),
          line("this month:", stats.thisMonth),
        ].join("\n  "),
    );
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
