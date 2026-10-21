// `npm run check:dashboard` — fills a SEPARATE database ("outreach_perf") with 10,000 fake messages, then
//   1. times every dashboard endpoint's service (must answer in under 300 ms), and
//   2. compares every dashboard number with an independent count done directly on the collections.
// Your real data (database "outreach") is never touched.
import { loadEnv } from "@/server/config/load-env";
loadEnv();
const PERF_DB = "outreach_perf";
{
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(
    process.env.MONGODB_URI ?? "",
  );
  if (!match) throw new Error("MONGODB_URI is missing or invalid");
  process.env.MONGODB_URI = `${match[1]}/${PERF_DB}${match[2] ?? ""}`;
  process.env.DRY_RUN = "true";
}

import { DateTime } from "luxon";
import mongoose from "mongoose";
import { getEnv } from "@/server/config/env";
import { connectDB, disconnectDB } from "@/server/db/connect";
import {
  Campaign,
  Contact,
  Domain,
  Event,
  Inbox,
  List,
  Message,
  ProviderConnection,
  Settings,
  allModels,
} from "@/server/db/models";
import {
  getDashboardActivity,
  getDashboardCampaigns,
  getDashboardInboxes,
  getDashboardSummary,
  getDashboardTimeline,
} from "@/server/services/dashboard.service";
import { acquireWorkerLock } from "@/server/services/worker.service";

const TOTAL_MESSAGES = 10_000;
const LIMIT_MS = 300;
const tz = getEnv().APP_TIMEZONE;

async function seed() {
  if (mongoose.connection.name !== PERF_DB) throw new Error("Refusing to touch another database");
  await mongoose.connection.dropDatabase();
  await Promise.all(allModels.map((m) => m.syncIndexes()));

  await Settings.create({ timezone: tz });
  const connection = await ProviderConnection.create({
    name: "perf",
    type: "microsoft",
    status: "connected",
  });
  const domain = await Domain.create({ name: "perf.test" });
  const inboxes = await Inbox.create(
    Array.from({ length: 10 }, (_, i) => ({
      email: `inbox${i}@perf.test`,
      domainId: domain._id,
      providerConnectionId: connection._id,
      dailyLimit: 50,
      status: i === 9 ? ("paused" as const) : ("active" as const),
    })),
  );
  const list = await List.create({ name: "perf list" });
  const campaigns = await Campaign.create([
    {
      name: "Running one",
      listId: list._id,
      inboxIds: inboxes.map((i) => i._id),
      status: "running",
      subjectTemplate: "s",
      bodyTemplate: "b",
    },
    {
      name: "Paused one",
      listId: list._id,
      inboxIds: inboxes.map((i) => i._id),
      status: "paused",
      subjectTemplate: "s",
      bodyTemplate: "b",
    },
    {
      name: "Done one",
      listId: list._id,
      inboxIds: inboxes.map((i) => i._id),
      status: "completed",
      completedAt: new Date(),
      subjectTemplate: "s",
      bodyTemplate: "b",
    },
  ]);

  const contacts = await Contact.insertMany(
    Array.from({ length: TOTAL_MESSAGES }, (_, i) => ({
      email: `p${i}@example.com`,
      listIds: [list._id],
    })),
    { ordered: false },
  );

  const now = Date.now();
  const docs = contacts.map((contact, i) => {
    const campaign = campaigns[i % 3];
    const inbox = inboxes[i % inboxes.length];
    const roll = i % 20;
    // ~55% sent over the last 20 days, ~5% failed, ~35% pending, ~5% skipped; a few scheduled below.
    const base = { campaignId: campaign._id, contactId: contact._id, toEmail: contact.email };
    if (roll < 11) {
      const sentAt = new Date(now - Math.floor(Math.random() * 20 * 24 * 3600 * 1000));
      return { ...base, inboxId: inbox._id, status: "sent", sentAt, attempts: 1 };
    }
    if (roll === 11) {
      const at = new Date(now - Math.floor(Math.random() * 20 * 24 * 3600 * 1000));
      return {
        ...base,
        inboxId: inbox._id,
        status: "failed",
        attempts: 3,
        error: { code: "HTTP_400", message: "x" },
        updatedAt: at,
        createdAt: at,
      };
    }
    if (roll === 12)
      return { ...base, status: "skipped", error: { code: "SUPPRESSED", message: "x" } };
    return { ...base, status: "pending" };
  });
  // One scheduled message per active inbox (the database allows only one in flight per inbox).
  for (let i = 0; i < 9; i++) {
    docs[i * 20 + 13] = {
      campaignId: campaigns[0]._id,
      contactId: contacts[i * 20 + 13]._id,
      toEmail: contacts[i * 20 + 13].email,
      inboxId: inboxes[i]._id,
      status: "scheduled",
      scheduledAt: new Date(now + (i + 1) * 60_000),
    } as (typeof docs)[number];
  }
  // timestamps:false keeps our fake updatedAt (the failure time) instead of "now".
  await Message.collection.insertMany(
    docs.map((d) => ({ createdAt: new Date(), updatedAt: new Date(), ...d })) as never[],
    { ordered: false },
  );

  await Event.insertMany(
    Array.from({ length: 5000 }, (_, i) => ({
      type: i % 3 ? "message.sent" : "message.failed",
      message: `event ${i}`,
      createdAt: new Date(now - i * 60_000),
    })),
  );
  await acquireWorkerLock("perf-check"); // so workerRunning is true
}

async function timed<T>(name: string, run: () => Promise<T>) {
  await run(); // warm-up (connection, plan cache)
  const times: number[] = [];
  let result!: T;
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    result = await run();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[3];
  const max = times[6];
  const pass = max < LIMIT_MS;
  console.log(
    `  ${pass ? "PASS" : "FAIL"}  ${name.padEnd(26)} median ${median.toFixed(0).padStart(4)} ms   max ${max.toFixed(0).padStart(4)} ms`,
  );
  return { result, pass };
}

const results: { name: string; pass: boolean }[] = [];
const record = (name: string, pass: boolean) => results.push({ name, pass });

async function main() {
  console.log(`Database: ${PERF_DB} — seeding ${TOTAL_MESSAGES.toLocaleString()} messages...`);
  await connectDB();
  await seed();
  const raw = mongoose.connection.db!;
  const messages = raw.collection("messages");
  console.log(`  messages in database: ${(await messages.countDocuments()).toLocaleString()}`);

  console.log(`\nSpeed (each endpoint's service, 7 runs, limit ${LIMIT_MS} ms):`);
  const summary = await timed("GET /summary", () => getDashboardSummary());
  const inboxes = await timed("GET /inboxes", () => getDashboardInboxes());
  const timeline = await timed("GET /timeline?days=14", () => getDashboardTimeline(14));
  const timeline90 = await timed("GET /timeline?days=90", () => getDashboardTimeline(90));
  const activity = await timed("GET /activity", () => getDashboardActivity());
  const campaigns = await timed("GET /campaigns", () => getDashboardCampaigns());
  for (const [name, t] of Object.entries({
    summary,
    inboxes,
    timeline,
    timeline90,
    activity,
    campaigns,
  })) {
    record(`${name} answers in under ${LIMIT_MS} ms`, t.pass);
  }

  console.log("\nCorrectness (dashboard vs. direct count on the collections):");
  const now = new Date();
  const local = DateTime.fromJSDate(now, { zone: tz });
  const dayStart = local.startOf("day").toJSDate();
  const weekStart = local.startOf("week").toJSDate();
  const s = summary.result;
  const compare = (name: string, dashboard: unknown, direct: unknown) => {
    const pass = JSON.stringify(dashboard) === JSON.stringify(direct);
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${name.padEnd(28)} dashboard ${JSON.stringify(dashboard)}   direct ${JSON.stringify(direct)}`,
    );
    record(`match: ${name}`, pass);
  };
  compare(
    "sentToday",
    s.sentToday,
    await messages.countDocuments({ status: "sent", sentAt: { $gte: dayStart } }),
  );
  compare(
    "sentThisWeek",
    s.sentThisWeek,
    await messages.countDocuments({ status: "sent", sentAt: { $gte: weekStart } }),
  );
  compare("totalSent", s.totalSent, await messages.countDocuments({ status: "sent" }));
  compare(
    "inQueue (pending+scheduled)",
    s.inQueue,
    (await messages.countDocuments({ status: "pending" })) +
      (await messages.countDocuments({ status: "scheduled" })),
  );
  compare(
    "failedToday",
    s.failedToday,
    await messages.countDocuments({ status: "failed", updatedAt: { $gte: dayStart } }),
  );
  compare(
    "activeInboxes",
    s.activeInboxes,
    await raw.collection("inboxes").countDocuments({ status: "active", deletedAt: null }),
  );
  const nextRaw = await messages
    .find({ status: "scheduled" })
    .sort({ scheduledAt: 1 })
    .limit(1)
    .next();
  compare("nextEmail.to", s.nextEmail?.to, nextRaw?.toEmail);
  compare("nextEmail.scheduledAt", s.nextEmail?.scheduledAt, nextRaw?.scheduledAt.toISOString());
  compare("workerRunning", s.workerRunning, true);

  // Per inbox
  const inboxDocs = await raw.collection("inboxes").find({}).sort({ email: 1 }).toArray();
  const directInboxes = [];
  for (const inbox of inboxDocs) {
    const next = await messages
      .find({ inboxId: inbox._id, status: "scheduled" })
      .sort({ scheduledAt: 1 })
      .limit(1)
      .next();
    directInboxes.push({
      email: inbox.email,
      sentToday: await messages.countDocuments({
        inboxId: inbox._id,
        status: "sent",
        sentAt: { $gte: dayStart },
      }),
      next: next?.scheduledAt.toISOString() ?? null,
    });
  }
  compare(
    "inboxes (sentToday, next send)",
    inboxes.result.map((i) => ({
      email: i.email,
      sentToday: i.sentToday,
      next: i.nextScheduledAt,
    })),
    directInboxes,
  );

  // Timeline: bucket every sent/failed message in JavaScript.
  const bucket = async (status: string, field: "sentAt" | "updatedAt") => {
    const map = new Map<string, number>();
    for await (const doc of messages.find({ status }, { projection: { [field]: 1 } })) {
      const day = DateTime.fromJSDate(doc[field] as Date, { zone: tz }).toFormat("yyyy-MM-dd");
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return map;
  };
  const [sentMap, failedMap] = await Promise.all([
    bucket("sent", "sentAt"),
    bucket("failed", "updatedAt"),
  ]);
  const directTimeline = Array.from({ length: 14 }, (_, i) => {
    const date = local
      .startOf("day")
      .minus({ days: 13 - i })
      .toFormat("yyyy-MM-dd");
    return { date, sent: sentMap.get(date) ?? 0, failed: failedMap.get(date) ?? 0 };
  });
  compare("timeline (14 days)", timeline.result, directTimeline);
  const timelineSent = timeline.result.reduce((a, d) => a + d.sent, 0);
  console.log(`        (the 14 days add up to ${timelineSent} sent emails)`);

  // Campaigns
  const directCampaigns = [];
  for (const c of await raw.collection("campaigns").find({}).toArray()) {
    directCampaigns.push({
      name: c.name,
      sent: await messages.countDocuments({ campaignId: c._id, status: "sent" }),
      total:
        (await messages.countDocuments({ campaignId: c._id })) -
        (await messages.countDocuments({ campaignId: c._id, status: "skipped" })),
    });
  }
  const norm = (rows: { name: string; sent: number; total: number }[]) =>
    [...rows].sort((a, b) => a.name.localeCompare(b.name));
  compare(
    "campaign cards (sent, total)",
    norm(campaigns.result.map((c) => ({ name: c.name, sent: c.sent, total: c.total }))),
    norm(directCampaigns),
  );
  compare(
    "activity (newest 20 events)",
    activity.result.map((e) => e.message),
    (await raw.collection("events").find({}).sort({ createdAt: -1 }).limit(20).toArray()).map(
      (e) => e.message,
    ),
  );

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(", ")}` : ""}`,
  );
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((err) => {
    console.error("check failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
    process.exit();
  });
