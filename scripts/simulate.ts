// `npm run simulate` — runs the REAL worker (as separate processes) in DRY_RUN against a separate database
// ("outreach_sim"), then checks the safety rules and prints a report. NOTHING is really sent.
//
// Scenarios (about 12 minutes in total):
//   1. main        3 inboxes (dailyLimit 5, gaps 10–20 s), 40 contacts, window covers now, ~6 minutes
//   2. window      the sending window closes during the run → nothing may be sent after it
//   3. pause       a second worker is refused; pausing the campaign stops sending within 30 s; resume works
//   4. crash       worker killed in the middle of a send → no duplicates, the stuck email is NOT resent
import { fork, type ChildProcess } from "node:child_process";
import { DateTime } from "luxon";
import mongoose from "mongoose";

// ---- Point everything at the simulation database BEFORE anything reads the environment ----
import { loadEnv } from "@/server/config/load-env";
loadEnv();
const SIM_DB = "outreach_sim";
process.env.MONGODB_URI = simUri(process.env.MONGODB_URI ?? "");
process.env.DRY_RUN = "true"; // never anything else in a simulation
process.env.SENDING_ENABLED = "false";

function simUri(uri: string): string {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error("MONGODB_URI is missing or not a valid MongoDB connection string");
  return `${match[1]}/${SIM_DB}${match[2] ?? ""}`;
}

import { getEnv } from "@/server/config/env";
import { connectDB, disconnectDB } from "@/server/db/connect";
import {
  Contact,
  Domain,
  Inbox,
  List,
  Message,
  ProviderConnection,
  Settings,
  allModels,
} from "@/server/db/models";
import { encrypt } from "@/server/lib/crypto";
import { isInsideWindow, type SendWindow } from "@/server/scheduler/time";
import {
  createCampaign,
  pauseCampaign,
  resumeCampaign,
  startCampaign,
} from "@/server/services/campaign.service";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ALL_DAY: SendWindow = { startMinute: 0, endMinute: 1440, days: [1, 2, 3, 4, 5, 6, 7] };

// ---------- helpers ----------

type Worker = {
  label: string;
  proc: ChildProcess;
  lines: string[];
  exit: Promise<number | null>;
  exited: () => boolean;
};

function startWorker(label: string): Worker {
  const proc = fork("src/worker/index.ts", [], {
    execArgv: ["--import", "tsx"],
    env: process.env,
    silent: true, // pipe stdout/stderr instead of printing them
  });
  const lines: string[] = [];
  const collect = (chunk: Buffer) => lines.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
  proc.stdout?.on("data", collect);
  proc.stderr?.on("data", collect);
  let done = false;
  const exit = new Promise<number | null>((resolve) =>
    proc.on("exit", (code) => {
      done = true;
      resolve(code);
    }),
  );
  return { label, proc, lines, exit, exited: () => done };
}

/** Ask the worker to stop gracefully (finish sends, release the lock). Resolves with its exit code. */
async function stopGracefully(worker: Worker): Promise<number | null> {
  if (worker.exited()) return worker.exit;
  worker.proc.send("shutdown");
  return Promise.race([worker.exit, sleep(40_000).then(() => "timeout" as const)]).then((r) =>
    r === "timeout" ? (worker.proc.kill(), null) : r,
  );
}

/** Instant death, like a crash or power cut (no cleanup runs). */
function killHard(worker: Worker) {
  worker.proc.kill("SIGKILL");
  return worker.exit;
}

async function resetDatabase() {
  const name = mongoose.connection.name;
  if (name !== SIM_DB)
    throw new Error(`Refusing to drop database "${name}" — only "${SIM_DB}" is allowed`);
  await mongoose.connection.dropDatabase();
  await Promise.all(allModels.map((m) => m.syncIndexes()));
}

async function seedWorld(options: {
  dailyLimit: number;
  window: SendWindow;
  contacts?: number;
  minGap?: number;
  maxGap?: number;
}) {
  const tz = getEnv().APP_TIMEZONE;
  await Settings.create({ timezone: tz });
  const connection = await ProviderConnection.create({
    name: "Simulation (fake)",
    type: "microsoft",
    tenantId: "sim",
    clientId: "sim",
    clientSecretEnc: encrypt("not-a-real-secret"),
    status: "connected",
  });
  const domain = await Domain.create({ name: "sim-outreach.test" });
  // Created directly: the inbox service requires gaps of at least 30 s, the simulation uses 10–20 s.
  const inboxes = await Inbox.create(
    ["alpha", "beta", "gamma"].map((name) => ({
      email: `${name}@sim-outreach.test`,
      displayName: name,
      domainId: domain._id,
      providerConnectionId: connection._id,
      dailyLimit: options.dailyLimit,
      minGapSeconds: options.minGap ?? 10,
      maxGapSeconds: options.maxGap ?? 20,
    })),
  );
  const list = await List.create({ name: "Simulation list" });
  await Contact.create(
    Array.from({ length: options.contacts ?? 40 }, (_, i) => ({
      email: `contact${String(i + 1).padStart(2, "0")}@example.com`,
      firstName: `Contact${i + 1}`,
      company: "Example Ltd",
      listIds: [list._id],
    })),
  );
  const campaign = await createCampaign({
    name: "Simulation campaign",
    listId: String(list._id),
    inboxIds: inboxes.map((i) => String(i._id)),
    subjectTemplate: "Quick question, {{firstName|there}}",
    bodyTemplate: "Hi {{firstName|there}}, this is a simulated email for {{company}}.",
    bodyHtml: null,
    sendWindow: { ...options.window, days: [...options.window.days] },
  });
  await startCampaign(campaign.id);
  return { tz, inboxes, campaignId: campaign.id };
}

/** Polls the database and remembers the highest number of scheduled+sending messages any inbox had. */
function watchInFlight() {
  const max = new Map<string, number>();
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const rows = await Message.aggregate<{ _id: unknown; n: number }>([
        { $match: { status: { $in: ["scheduled", "sending"] } } },
        { $group: { _id: "$inboxId", n: { $sum: 1 } } },
      ]);
      for (const row of rows) {
        const key = String(row._id);
        max.set(key, Math.max(max.get(key) ?? 0, row.n));
      }
      await sleep(150);
    }
  })();
  return {
    max,
    stop: async () => {
      stopped = true;
      await loop;
    },
  };
}

type Analysis = {
  perInbox: { email: string; sent: number; maxInFlight: number; minGapSeconds: number | null }[];
  totalSent: number;
  outsideWindow: number;
  duplicates: number;
  counts: Record<string, number>;
};

async function analyse(
  inboxes: { _id: unknown; email: string }[],
  window: SendWindow,
  tz: string,
  workers: Worker[],
  maxInFlight: Map<string, number>,
): Promise<Analysis> {
  const sent = await Message.find({ status: "sent" }).sort({ sentAt: 1 }).lean();
  const perInbox = inboxes.map((inbox) => {
    const times = sent
      .filter((m) => String(m.inboxId) === String(inbox._id))
      .map((m) => m.sentAt!.getTime());
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / 1000);
    return {
      email: inbox.email,
      sent: times.length,
      maxInFlight: maxInFlight.get(String(inbox._id)) ?? 0,
      minGapSeconds: gaps.length ? Math.round(Math.min(...gaps) * 10) / 10 : null,
    };
  });

  const outsideWindow = sent.filter((m) => !isInsideWindow(m.sentAt!, window, tz)).length;

  // Duplicates: the same recipient "sent" more than once, by the database or in any worker's log.
  const perRecipient = new Map<string, number>();
  for (const line of workers.flatMap((w) => w.lines)) {
    const match = /\[DRY RUN\] not really sent: .* to=(\S+) /.exec(line);
    if (match) perRecipient.set(match[1], (perRecipient.get(match[1]) ?? 0) + 1);
  }
  const loggedDuplicates = [...perRecipient.values()].filter((n) => n > 1).length;
  const dbDuplicates = await Message.aggregate([
    { $group: { _id: { c: "$campaignId", x: "$contactId" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  const idDuplicates = new Set(sent.map((m) => m.providerMessageId)).size !== sent.length ? 1 : 0;

  const counts: Record<string, number> = {};
  for (const row of await Message.aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ])) {
    counts[row._id] = row.n;
  }
  return {
    perInbox,
    totalSent: sent.length,
    outsideWindow,
    duplicates: loggedDuplicates + dbDuplicates.length + idDuplicates,
    counts,
  };
}

function printAnalysis(a: Analysis) {
  console.log("  inbox                     sent  max in flight  smallest gap (s)");
  for (const row of a.perInbox) {
    console.log(
      `  ${row.email.padEnd(26)}${String(row.sent).padEnd(6)}${String(row.maxInFlight).padEnd(15)}${row.minGapSeconds ?? "-"}`,
    );
  }
  console.log(`  total sent: ${a.totalSent}   statuses: ${JSON.stringify(a.counts)}`);
  console.log(`  sends outside the window: ${a.outsideWindow}   duplicates: ${a.duplicates}`);
}

type Check = { scenario: string; name: string; pass: boolean; detail?: string };
const checks: Check[] = [];
function check(scenario: string, name: string, pass: boolean, detail = "") {
  checks.push({ scenario, name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const heading = (text: string) => console.log(`\n=== ${text} ===`);
const minuteOfDay = (d: Date, tz: string) => {
  const t = DateTime.fromJSDate(d, { zone: tz });
  return t.hour * 60 + t.minute + t.second / 60;
};

// ---------- scenario 1: main ----------

async function scenarioMain() {
  heading(
    "1. MAIN: 3 inboxes × dailyLimit 5, gaps 10–20 s, 40 contacts, window covers now, ~6 minutes",
  );
  await resetDatabase();
  const world = await seedWorld({ dailyLimit: 5, window: ALL_DAY });
  const watcher = watchInFlight();
  const worker = startWorker("main");
  const started = Date.now();
  while (Date.now() - started < 360_000) {
    await sleep(30_000);
    const sent = await Message.countDocuments({ status: "sent" });
    console.log(`  ... ${Math.round((Date.now() - started) / 1000)} s: ${sent} sent`);
  }
  const code = await stopGracefully(worker);
  await watcher.stop();
  const a = await analyse(world.inboxes, ALL_DAY, world.tz, [worker], watcher.max);
  printAnalysis(a);

  check(
    "main",
    "exactly 15 sent (3 inboxes × 5 per day)",
    a.totalSent === 15,
    `sent ${a.totalSent}`,
  );
  check(
    "main",
    "every inbox sent exactly 5",
    a.perInbox.every((i) => i.sent === 5),
  );
  check(
    "main",
    "never more than 1 message in flight per inbox",
    a.perInbox.every((i) => i.maxInFlight <= 1),
  );
  check(
    "main",
    "gaps respected (smallest gap ≥ 10 s)",
    a.perInbox.every((i) => i.minGapSeconds === null || i.minGapSeconds >= 10),
  );
  check("main", "nothing sent outside the window", a.outsideWindow === 0);
  check("main", "no duplicates", a.duplicates === 0);
  check(
    "main",
    "25 contacts still pending (daily limit stopped the rest)",
    (a.counts.pending ?? 0) === 25,
    `pending ${a.counts.pending ?? 0}`,
  );
  check(
    "main",
    "worker stopped gracefully (exit code 0, lock released)",
    code === 0 && (await Settings.findOne())?.workerLockId === null,
  );
}

// ---------- scenario 2: window ----------

async function scenarioWindow() {
  heading("2. WINDOW: the sending window closes during the run");
  await resetDatabase();
  const tz = getEnv().APP_TIMEZONE;
  const now = DateTime.now().setZone(tz);
  const nowMinute = now.hour * 60 + now.minute;
  // Window: from a minute ago until the first full minute that is at least 100 s away.
  const endMinute = Math.ceil((nowMinute * 60 + now.second + 100) / 60);
  const window: SendWindow = {
    startMinute: Math.max(0, nowMinute - 1),
    endMinute,
    days: [1, 2, 3, 4, 5, 6, 7],
  };
  if (endMinute > 1440 || nowMinute < 1) {
    console.log("  (skipped: too close to midnight for a clean window test — run it again)");
    return;
  }
  const world = await seedWorld({ dailyLimit: 50, window });
  const endAt = now.startOf("day").plus({ minutes: endMinute }).toJSDate();
  console.log(
    `  window ends at ${DateTime.fromJSDate(endAt, { zone: tz }).toFormat("HH:mm:ss")} (${tz})`,
  );

  const watcher = watchInFlight();
  const worker = startWorker("window");
  await sleep(endAt.getTime() - Date.now() + 45_000);
  const code = await stopGracefully(worker);
  await watcher.stop();
  const a = await analyse(world.inboxes, window, tz, [worker], watcher.max);
  printAnalysis(a);
  const last = await Message.findOne({ status: "sent" }).sort({ sentAt: -1 }).lean();
  console.log(
    `  last send: ${last ? DateTime.fromJSDate(last.sentAt!, { zone: tz }).toFormat("HH:mm:ss") : "none"}`,
  );
  const lateInFlight = await Message.countDocuments({ status: { $in: ["scheduled", "sending"] } });
  check(
    "window",
    "emails were sent while the window was open",
    a.totalSent > 0,
    `sent ${a.totalSent}`,
  );
  check(
    "window",
    "nothing sent outside the window",
    a.outsideWindow === 0 && (!last || minuteOfDay(last.sentAt!, tz) < endMinute),
  );
  check(
    "window",
    "nothing left in flight after the window closed",
    lateInFlight === 0,
    `${lateInFlight} left`,
  );
  check(
    "window",
    "never more than 1 in flight per inbox",
    a.perInbox.every((i) => i.maxInFlight <= 1),
  );
  check("window", "no duplicates", a.duplicates === 0);
  check("window", "worker stopped gracefully", code === 0);
}

// ---------- scenario 3: second worker + pause/resume ----------

async function scenarioPause() {
  heading("3. PAUSE: a second worker is refused; pausing stops sending within 30 s; resume works");
  await resetDatabase();
  const world = await seedWorld({ dailyLimit: 50, window: ALL_DAY });
  const watcher = watchInFlight();
  const first = startWorker("first");
  while ((await Message.countDocuments({ status: "sent" })) < 3) await sleep(1000);

  // A second worker must refuse to start while the first holds the lock.
  const second = startWorker("second");
  const secondCode = await Promise.race([
    second.exit,
    sleep(30_000).then(() => "timeout" as const),
  ]);
  if (secondCode === "timeout") second.proc.kill();
  check(
    "pause",
    "a second worker refuses to start and exits",
    secondCode !== "timeout" && secondCode !== 0,
    `exit code ${secondCode}`,
  );
  check(
    "pause",
    "…and says why in its log",
    second.lines.some((l) => l.includes("another worker is already running")),
  );
  const sentBefore = await Message.countDocuments({ status: "sent" });
  await sleep(40_000); // sends go out in rounds about 30 s apart (planner interval)
  check(
    "pause",
    "the first worker kept sending",
    (await Message.countDocuments({ status: "sent" })) > sentBefore,
  );

  // Pause the campaign.
  const pausedAt = new Date();
  await pauseCampaign(world.campaignId);
  console.log(`  campaign paused at ${pausedAt.toISOString()}`);
  const scheduledRightAfter = await Message.countDocuments({ status: "scheduled" });
  await sleep(40_000);
  const afterPause = await Message.find({ status: "sent", sentAt: { $gt: pausedAt } })
    .sort({ sentAt: -1 })
    .lean();
  const latestAfter = afterPause[0]
    ? (afterPause[0].sentAt!.getTime() - pausedAt.getTime()) / 1000
    : 0;
  console.log(
    `  sends after the pause click: ${afterPause.length} (the last one ${latestAfter.toFixed(1)} s later)`,
  );
  check(
    "pause",
    "no email was sent more than 30 s after pausing",
    latestAfter <= 30,
    `${latestAfter.toFixed(1)} s`,
  );
  check(
    "pause",
    "scheduled emails went back to pending",
    scheduledRightAfter === 0,
    `${scheduledRightAfter} still scheduled`,
  );
  const sentWhilePaused = await Message.countDocuments({
    status: "sent",
    sentAt: { $gt: new Date(pausedAt.getTime() + 5_000) },
  });
  check(
    "pause",
    "nothing is sent while paused (after the in-progress send finished)",
    sentWhilePaused === 0,
  );

  // Resume.
  const sentBeforeResume = await Message.countDocuments({ status: "sent" });
  await resumeCampaign(world.campaignId);
  const resumeBy = Date.now() + 90_000;
  while (
    Date.now() < resumeBy &&
    (await Message.countDocuments({ status: "sent" })) === sentBeforeResume
  )
    await sleep(1000);
  check(
    "pause",
    "sending continues after resume",
    (await Message.countDocuments({ status: "sent" })) > sentBeforeResume,
  );

  const code = await stopGracefully(first);
  await watcher.stop();
  const a = await analyse(world.inboxes, ALL_DAY, world.tz, [first, second], watcher.max);
  printAnalysis(a);
  check(
    "pause",
    "never more than 1 in flight per inbox",
    a.perInbox.every((i) => i.maxInFlight <= 1),
  );
  check("pause", "no duplicates", a.duplicates === 0);
  check(
    "pause",
    "heartbeat cleared on clean stop (health shows worker stopped)",
    code === 0 && (await Settings.findOne())?.workerHeartbeatAt === null,
  );
}

// ---------- scenario 4: crash mid-send ----------

async function scenarioCrash() {
  heading("4. CRASH: the worker is killed in the middle of a send");
  const workers: Worker[] = [];
  let stuckId: unknown = null;
  let world!: Awaited<ReturnType<typeof seedWorld>>;
  let watcher!: ReturnType<typeof watchInFlight>;

  for (let attempt = 1; attempt <= 6 && !stuckId; attempt++) {
    await resetDatabase();
    world = await seedWorld({ dailyLimit: 50, window: ALL_DAY });
    watcher = watchInFlight();
    const victim = startWorker(`victim-${attempt}`);
    workers.push(victim);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !stuckId) {
      const sending = await Message.findOne({ status: "sending" }).lean();
      if (sending) {
        await killHard(victim);
        const after = await Message.findById(sending._id).lean();
        if (after?.status === "sending") stuckId = sending._id;
      } else await sleep(20);
    }
    if (!stuckId) {
      if (!victim.exited()) await killHard(victim);
      await watcher.stop();
      console.log(`  (attempt ${attempt}: the send finished before the kill — trying again)`);
    }
  }
  if (!stuckId) {
    check("crash", "could catch a send in progress", false);
    return;
  }

  // Every inbox may have had a send in progress (one each), so all of them are "stuck".
  const stuckMessages = await Message.find({ status: "sending" }).lean();
  const stuckIds = stuckMessages.map((m) => m._id);
  const sentAtKill = await Message.countDocuments({ status: "sent" });
  console.log(
    `  killed the worker while sending to ${stuckMessages.map((m) => m.toEmail).join(", ")}; ${sentAtKill} already sent`,
  );
  check(
    "crash",
    "the interrupted emails are stuck in 'sending' (not resent, not lost)",
    stuckIds.length >= 1,
  );

  // The dead worker still holds the lock for up to 90 s: a restart right away is refused.
  const tooEarly = startWorker("restart-too-early");
  workers.push(tooEarly);
  const tooEarlyCode = await Promise.race([
    tooEarly.exit,
    sleep(30_000).then(() => "timeout" as const),
  ]);
  if (tooEarlyCode === "timeout") tooEarly.proc.kill();
  check(
    "crash",
    "restarting before the dead worker's lock expires is refused",
    tooEarlyCode !== "timeout" && tooEarlyCode !== 0,
    `exit code ${tooEarlyCode}`,
  );

  // Simulate 3 minutes passing (lock 90 s + message lock 2 min) instead of waiting for real.
  const past = new Date(Date.now() - 1000);
  await Settings.updateOne({}, { $set: { workerLockExpiresAt: past } });
  await Message.updateMany({ _id: { $in: stuckIds } }, { $set: { lockedUntil: past } });

  const restarted = startWorker("restarted");
  workers.push(restarted);
  const recoverBy = Date.now() + 40_000;
  while (
    Date.now() < recoverBy &&
    (await Message.countDocuments({ _id: { $in: stuckIds }, status: "sending" })) > 0
  ) {
    await sleep(500);
  }
  const recovered = await Message.find({ _id: { $in: stuckIds } }).lean();
  check(
    "crash",
    "the new worker marked every interrupted email failed with UNKNOWN_STATE",
    recovered.every((m) => m.status === "failed" && m.error?.code === "UNKNOWN_STATE"),
  );

  // Let the restarted worker run for a while, then stop it in the middle of a send (graceful).
  await sleep(45_000);
  let midSend: unknown = null;
  const midDeadline = Date.now() + 60_000;
  while (Date.now() < midDeadline && !midSend) {
    midSend =
      (await Message.findOne({ status: "sending", _id: { $nin: stuckIds } }).lean())?._id ?? null;
    if (!midSend) await sleep(20);
  }
  const code = await stopGracefully(restarted);
  await watcher.stop();
  if (midSend) {
    const status = (await Message.findById(midSend).lean())?.status;
    check(
      "crash",
      "graceful shutdown finished the send in progress",
      status === "sent",
      `status ${status}`,
    );
  }
  const settings = await Settings.findOne().lean();
  check(
    "crash",
    "graceful shutdown released the lock (exit code 0)",
    code === 0 && settings?.workerLockId === null,
  );

  const stillStuck = await Message.find({ _id: { $in: stuckIds } }).lean();
  const a = await analyse(world.inboxes, ALL_DAY, world.tz, workers, watcher.max);
  printAnalysis(a);
  check(
    "crash",
    "the interrupted emails were never sent again",
    stillStuck.every((m) => m.status === "failed" && m.attempts === 1),
  );
  check("crash", "no duplicate sends across both workers", a.duplicates === 0);
  check(
    "crash",
    "nothing stays in 'sending' forever",
    (await Message.countDocuments({ status: "sending" })) === 0,
  );
}

// ---------- main ----------

async function main() {
  const env = getEnv();
  console.log(`Simulation database: ${SIM_DB} (DRY_RUN=${env.DRY_RUN}) — nothing is really sent.`);
  await connectDB();
  const only = process.argv[2];
  const scenarios: Record<string, () => Promise<void>> = {
    main: scenarioMain,
    window: scenarioWindow,
    pause: scenarioPause,
    crash: scenarioCrash,
  };
  for (const [name, run] of Object.entries(scenarios)) {
    if (!only || only === name) await run();
  }

  heading("SUMMARY");
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  [${c.scenario}] ${c.name}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(
    `\n${checks.length - failed}/${checks.length} checks passed${failed ? ` — ${failed} FAILED` : ""}`,
  );
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((err) => {
    console.error("simulation crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
    process.exit();
  });
