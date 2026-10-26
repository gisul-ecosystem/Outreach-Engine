// `npm run mailbox:check` — runs the bounce/reply reader once now (the worker also does it every 5 minutes)
// and prints the bounce reports found in each sending inbox during the last `--minutes` (default 60).
// Read-only towards Microsoft. Needs the Mail.Read application permission.
import { loadEnv } from "@/server/config/load-env";
loadEnv();

import { connectDB, disconnectDB } from "@/server/db/connect";
import { Inbox, ProviderConnection } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { parseBounce } from "@/server/lib/bounce";
import { getVerificationProvider, sendingMode } from "@/server/providers";
import { mailboxTick } from "@/server/scheduler/mailbox";

async function main() {
  const index = process.argv.indexOf("--minutes");
  const minutes = index >= 0 ? Number(process.argv[index + 1]) : 60;
  await connectDB();
  if (sendingMode() === "dry-run") {
    console.log("DRY_RUN=true: nothing was really sent, so there is nothing to check.");
    return;
  }

  const since = new Date(Date.now() - minutes * 60_000);
  const inboxes = await Inbox.find(notDeleted({ providerConnectionId: { $ne: null } })).lean();
  for (const inbox of inboxes) {
    const connection = await ProviderConnection.findOne(
      notDeleted({ _id: inbox.providerConnectionId }),
    )
      .select("+clientSecretEnc")
      .lean();
    if (!connection) continue;
    try {
      const emails = await getVerificationProvider(connection).listReceivedEmails(
        inbox.email,
        since,
      );
      const bounces = emails.flatMap((e) => {
        const bounce = parseBounce(e);
        return bounce ? [{ e, bounce }] : [];
      });
      console.log(
        `\n${inbox.email}: ${emails.length} email(s) in the last ${minutes} min, ${bounces.length} bounce report(s)`,
      );
      for (const { e, bounce } of bounces) {
        console.log(`  ${e.receivedAt.toISOString()}  ${bounce.smtp}  "${e.subject}"`);
        console.log(`    ${bounce.reason}`);
        console.log(
          `    original Message-ID: ${bounce.originalMessageId ?? "(not in the report)"}`,
        );
      }
    } catch (err) {
      console.log(
        `\n${inbox.email}: cannot read the mailbox — ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  const result = await mailboxTick();
  console.log(`\nEngine updated: ${JSON.stringify(result)}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
