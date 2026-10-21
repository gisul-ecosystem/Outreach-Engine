import {
  Campaign,
  Contact,
  Domain,
  Inbox,
  List,
  Message,
  ProviderConnection,
  Settings,
} from "@/server/db/models";

/** 2026-10-20 is a Tuesday. 06:00Z = 11:30 IST, inside the default 10:00–18:00 window. */
export const NOW = new Date("2026-10-20T06:00:00Z");
export const WINDOW = { startMinute: 600, endMinute: 1080, days: [1, 2, 3, 4, 5] };

/** A small, complete world for scheduler tests: connection, domain, inboxes, contacts, a running campaign. */
export async function createWorld(
  options: {
    inboxes?: number;
    contacts?: number;
    dailyLimit?: number;
    minGap?: number;
    maxGap?: number;
    campaignStatus?: "running" | "draft" | "paused";
    connectionStatus?: "connected" | "unchecked" | "error";
    window?: typeof WINDOW;
  } = {},
) {
  await Settings.create({ timezone: "Asia/Kolkata" });
  const connection = await ProviderConnection.create({
    name: "M365",
    type: "microsoft",
    tenantId: "t",
    clientId: "c",
    status: options.connectionStatus ?? "connected",
  });
  const domain = await Domain.create({ name: "tryracko.in" });
  const inboxes = [];
  for (let i = 0; i < (options.inboxes ?? 2); i++) {
    inboxes.push(
      await Inbox.create({
        email: `inbox${i}@tryracko.in`,
        domainId: domain._id,
        providerConnectionId: connection._id,
        dailyLimit: options.dailyLimit ?? 5,
        minGapSeconds: options.minGap ?? 10,
        maxGapSeconds: options.maxGap ?? 20,
      }),
    );
  }
  const list = await List.create({ name: "Leads" });
  const contacts = await Contact.create(
    Array.from({ length: options.contacts ?? 10 }, (_, i) => ({
      email: `person${i}@example.com`,
      firstName: `Person${i}`,
      listIds: [list._id],
    })),
  );
  const campaign = await Campaign.create({
    name: "Test campaign",
    listId: list._id,
    inboxIds: inboxes.map((i) => i._id),
    subjectTemplate: "Hi {{firstName}}",
    bodyTemplate: "Hello {{firstName|there}}",
    sendWindow: options.window ?? WINDOW,
    status: options.campaignStatus ?? "running",
  });
  await Message.insertMany(
    contacts.map((c) => ({
      campaignId: campaign._id,
      contactId: c._id,
      toEmail: c.email,
      status: "pending",
    })),
  );
  return { connection, domain, inboxes, list, contacts, campaign };
}

export const countBy = (filter: Record<string, unknown>) => Message.countDocuments(filter);
