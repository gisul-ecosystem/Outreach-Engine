// `npm run email:test -- [options]` — show (and optionally send) one campaign email to TEST addresses,
// built by the engine's real code: composeEmail() + the provider's send() — the same path the worker uses.
//
//   --campaign "<name>"        the campaign, as saved in the app (required)
//   --version "<name>"         which template version (default: the main one)
//   --to a@x.com,b@y.com       test recipients (required)
//   --from <inbox email>       sending inbox (default: the campaign's first inbox)
//   --first-name / --company / --last-name / --title   sample values (default: the first contact
//                              of the campaign's list; given values replace that contact's values)
//   --send --yes               really send (without both flags: preview only, nothing is sent)
//   --gap <seconds>            wait between recipients (default 180)
//   --format outlook|mime      try the other format for this test (default: the connection's setting)
//
// Shows exactly what goes to Microsoft in the format used: Outlook format → the JSON request
// (Microsoft builds the email); MIME format → the raw email. After a real Outlook-format send it
// reads the Message-ID Microsoft gave the email from Sent Items (needs the Mail.Read permission).
//
// Everything comes from the app's database: campaign, template, inbox, signature. Nothing is built in.
// Never sends to a suppressed address. Real email only when DRY_RUN=false and SENDING_ENABLED=true.
import { loadEnv } from "@/server/config/load-env";
loadEnv();

import { connectDB, disconnectDB } from "@/server/db/connect";
import { Campaign, Contact, Inbox, ProviderConnection, Suppression } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { campaignTemplates, composeEmail } from "@/server/lib/compose";
import { checkEmailContent } from "@/server/lib/content-check";
import { mimeForSend } from "@/server/lib/mime";
import { outlookSendMailBody } from "@/server/lib/outlook-message";
import type { TemplateContact } from "@/server/lib/template";
import {
  getProvider,
  getVerificationProvider,
  ProviderError,
  sendFormatOf,
  sendingMode,
} from "@/server/providers";
import { logEvent } from "@/server/services/event.service";
import { SEND_FORMATS, type SendFormat } from "@/shared/enums";

/** Graph needs a few seconds to put a sent email in Sent Items. */
const SENT_ITEMS_WAITS_MS = [5_000, 10_000, 20_000];

function arg(name: string, fallback = ""): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const campaignName = arg("campaign");
  const recipients = arg("to")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const gapSeconds = Number(arg("gap", "180"));
  if (!campaignName) throw new Error('Name the campaign with --campaign "<name>"');
  if (recipients.length === 0) throw new Error("Give at least one test address with --to");

  await connectDB();
  const campaign = await Campaign.findOne(notDeleted({ name: campaignName })).lean();
  if (!campaign) throw new Error(`No campaign called "${campaignName}"`);

  const versionName = arg("version");
  const templates = campaignTemplates(campaign);
  const template = versionName ? templates.find((t) => t.name === versionName) : templates[0];
  if (!template) {
    throw new Error(
      `No version "${versionName}". Versions: ${templates.map((t) => t.name).join(", ")}`,
    );
  }

  const from = arg("from").toLowerCase();
  const inbox = await Inbox.findOne(
    notDeleted(from ? { email: from } : { _id: { $in: campaign.inboxIds ?? [] } }),
  ).lean();
  if (!inbox) throw new Error(from ? `No inbox ${from}` : "The campaign has no inbox");

  // Sample values: the list's first contact, with any values given on the command line on top.
  const sample: Partial<TemplateContact> =
    (await Contact.findOne(notDeleted({ listIds: campaign.listId, status: "active" }))
      .sort({ _id: 1 })
      .lean()) ?? {};
  const overrides = Object.fromEntries(
    (
      [
        ["firstName", "first-name"],
        ["lastName", "last-name"],
        ["company", "company"],
        ["title", "title"],
      ] as const
    ).flatMap(([field, name]) => (arg(name) ? [[field, arg(name)]] : [])),
  );
  const contactValues = { ...sample, ...overrides };

  const connection = await ProviderConnection.findOne(
    notDeleted({ _id: inbox.providerConnectionId }),
  )
    .select("+clientSecretEnc")
    .lean();
  const formatArg = arg("format");
  if (formatArg && !SEND_FORMATS.includes(formatArg as SendFormat)) {
    throw new Error(`--format must be one of: ${SEND_FORMATS.join(", ")}`);
  }
  const format = (formatArg as SendFormat) || sendFormatOf(connection);
  console.log(`Campaign "${campaign.name}", version "${template.name}", from ${inbox.email}`);
  console.log(
    `Format: ${format === "outlook" ? "Outlook standard — JSON, Microsoft builds the email" : "MIME — the engine builds the raw email"}${formatArg ? " (--format)" : " (the connection's setting)"}`,
  );

  const content = checkEmailContent(template);
  for (const problem of content.problems) console.log(`  PROBLEM: ${problem}`);
  for (const warning of content.warnings) console.log(`  warning: ${warning}`);

  const doSend = flag("send") && flag("yes");
  if (flag("send") && !flag("yes"))
    console.log("\n--send needs --yes as well. Preview only, nothing is sent.");
  const mode = sendingMode();
  if (doSend && mode !== "live") {
    console.log(
      `\nSending mode is "${mode}" — ${mode === "dry-run" ? "the FakeProvider is used, nothing really leaves" : "SENDING_ENABLED=false, nothing can be sent"}.`,
    );
  }

  for (const [i, to] of recipients.entries()) {
    const { rendered, input } = composeEmail({
      template,
      contact: { ...contactValues, email: to },
      inbox,
      to,
    });
    if (rendered.missing.length) {
      console.log(
        `\n${to}: NOT SENT — empty: ${rendered.missing.join(", ")} (fill the inbox signature / sample values)`,
      );
      continue;
    }
    if (format === "outlook") {
      console.log(`\n========== Request to Microsoft for ${to} (Outlook format) ==========`);
      console.log(`POST https://graph.microsoft.com/v1.0/users/${inbox.email}/sendMail`);
      console.log("Content-Type: application/json\n");
      console.log(JSON.stringify(outlookSendMailBody(input), null, 2));
      console.log(
        "(No Message-ID, Date, Reply-To or List-Unsubscribe: Microsoft adds its own, like Outlook.)",
      );
    } else {
      console.log(`\n========== Raw email to ${to} (MIME format) ==========`);
      console.log(mimeForSend(input).mime);
    }
    console.log("========== end ==========");
    if (!doSend) continue;

    if (await Suppression.exists({ email: to })) {
      console.log(`${to}: NOT SENT — on the do-not-contact list`);
      continue;
    }
    if (i > 0 && gapSeconds > 0) {
      console.log(`Waiting ${gapSeconds} s before the next send...`);
      await new Promise((resolve) => setTimeout(resolve, gapSeconds * 1000));
    }
    if (!connection) throw new Error(`Inbox ${inbox.email} has no provider connection`);
    const sentAt = new Date();
    try {
      const result = await getProvider(
        { ...connection, sendFormat: format },
        { fakeFailureRate: 0 },
      ).send(input);
      console.log(
        `${to}: ACCEPTED by ${mode === "live" ? "Microsoft (HTTP 202)" : "the FakeProvider"} at ${sentAt.toISOString()} — ${result.format === "outlook" ? "Outlook" : "MIME"} format`,
      );
      if (result.format === "outlook" && mode === "live") {
        console.log(
          `  Message-ID: ${await messageIdFromSentItems(connection, inbox.email, to, input.subject, sentAt)}`,
        );
      } else {
        console.log(`  Message-ID: ${result.internetMessageId ?? input.messageId}`);
      }
      await logEvent(
        "inbox.test_sent",
        `Test "${campaignName}" ${mode === "live" ? "sent" : "simulated"} from ${inbox.email} to ${to} (${format} format)`,
        {
          inboxId: inbox._id,
          domainId: inbox.domainId,
        },
      );
    } catch (err) {
      const detail =
        err instanceof ProviderError
          ? `${err.code} (HTTP ${err.status ?? "-"}): ${err.message}`
          : String(err);
      console.log(`${to}: ERROR BEFORE SENDING — ${detail}`);
    }
  }
  if (doSend && mode === "live") {
    console.log(
      "\nAccepted only means Microsoft took the email. Wait ~5 minutes, then run: npm run mailbox:check",
    );
  }
}

/**
 * Outlook format: Microsoft made the Message-ID, so look for the email in Sent Items (Mail.Read).
 * Only reads — never sends. Returns a readable line either way.
 */
async function messageIdFromSentItems(
  connection: Parameters<typeof getVerificationProvider>[0],
  mailbox: string,
  to: string,
  subject: string,
  sentAt: Date,
): Promise<string> {
  const provider = getVerificationProvider(connection);
  if (!provider.listSentEmails) return "(unknown)";
  for (const wait of SENT_ITEMS_WAITS_MS) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const sent = await provider.listSentEmails(mailbox, new Date(sentAt.getTime() - 60_000));
      const match = sent.find((s) => s.to.includes(to) && s.subject === subject);
      if (match) return `${match.internetMessageId} (made by Microsoft, read from Sent Items)`;
    } catch (err) {
      return `not read — ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return "not in Sent Items yet — the worker's mailbox check fills it in later";
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
