// "Outlook readiness" facts from the database, and the Must-fix list that Start/Resume enforce.
// The rules themselves are in src/shared/readiness.ts (the browser runs the same ones while typing).
import type { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Campaign, Contact, Domain, Inbox, ProviderConnection } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { campaignTemplates, type CampaignTemplates } from "@/server/lib/compose";
import { ApiError } from "@/server/lib/errors";
import { STANDARD_VARIABLES } from "@/shared/campaign";
import {
  checkCampaignContent,
  checkSenders,
  checkSetup,
  mustFixMessages,
  type CampaignReadinessDTO,
  type ReadinessContext,
  type ReadinessFacts,
  type ReadinessInbox,
  type ReadinessItem,
} from "@/shared/readiness";

export type CampaignForReadiness = CampaignTemplates & {
  _id: Types.ObjectId;
  listId: Types.ObjectId;
  inboxIds?: Types.ObjectId[] | null;
  followUpOf?: Types.ObjectId | null;
  testSentAt?: Date | null;
};

/** custom.<key> columns that any contact of the list has (all contacts, so none is missed). */
export async function listCustomVariables(listId: Types.ObjectId): Promise<string[]> {
  const rows = await Contact.aggregate<{ _id: string }>([
    { $match: { listIds: listId, deletedAt: null } },
    { $project: { kv: { $objectToArray: { $ifNull: ["$custom", {}] } } } },
    { $unwind: "$kv" },
    { $group: { _id: "$kv.k" } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => `custom.${r._id}`);
}

/** For each field: how many active contacts of the list have it empty (they would be skipped). */
export async function emptyFieldCounts(
  listId: Types.ObjectId,
  customVariables: string[],
): Promise<Record<string, number>> {
  const fields = [...STANDARD_VARIABLES.filter((f) => f !== "email"), ...customVariables];
  const isEmpty = (path: string) => ({
    $cond: [
      { $gt: [{ $strLenCP: { $trim: { input: { $toString: { $ifNull: [path, ""] } } } } }, 0] },
      0,
      1,
    ],
  });
  const group: { _id: null } & Record<string, unknown> = { _id: null };
  fields.forEach((field, i) => {
    group[`f${i}`] = {
      $sum: isEmpty(field.startsWith("custom.") ? `$custom.${field.slice(7)}` : `$${field}`),
    };
  });
  const [row] = await Contact.aggregate<Record<string, number>>([
    { $match: { listIds: listId, deletedAt: null, status: "active" } },
    { $group: group },
  ]);
  return Object.fromEntries(fields.map((field, i) => [field, row?.[`f${i}`] ?? 0]));
}

/** Everything the checks need to know from the database. */
async function gather(campaign: CampaignForReadiness) {
  const inboxDocs = await Inbox.find(notDeleted({ _id: { $in: campaign.inboxIds ?? [] } }))
    .select("email displayName senderName senderRole status domainId providerConnectionId")
    .lean();
  const [domains, connections, customVariables] = await Promise.all([
    Domain.find({ _id: { $in: inboxDocs.map((i) => i.domainId) } })
      .select("name dns")
      .lean(),
    ProviderConnection.find(
      notDeleted({
        _id: {
          $in: inboxDocs.flatMap((i) => (i.providerConnectionId ? [i.providerConnectionId] : [])),
        },
      }),
    )
      .select("name status grantedPermissions")
      .lean(),
    listCustomVariables(campaign.listId),
  ]);
  const inboxes: ReadinessInbox[] = inboxDocs.map((i) => ({
    id: String(i._id),
    email: i.email,
    displayName: i.displayName ?? "",
    senderName: i.senderName ?? "",
    senderRole: i.senderRole ?? "",
    status: i.status ?? "active",
    connectionId: i.providerConnectionId ? String(i.providerConnectionId) : null,
  }));
  const context: ReadinessContext = {
    isFollowUp: !!campaign.followUpOf,
    customVariables,
    sendingDomains: domains.map((d) => d.name),
    emptyFields: await emptyFieldCounts(campaign.listId, customVariables),
  };
  const facts: ReadinessFacts = {
    inboxes,
    domains: domains.map((d) => ({
      id: String(d._id),
      name: d.name,
      dns: {
        spf: d.dns?.spf ?? "unknown",
        dkim: d.dns?.dkim ?? "unknown",
        dmarc: d.dns?.dmarc ?? "unknown",
        mx: d.dns?.mx ?? "unknown",
      },
    })),
    connections: connections.map((c) => ({
      id: String(c._id),
      name: c.name,
      status: c.status ?? "unchecked",
      grantedPermissions: c.grantedPermissions ? [...c.grantedPermissions] : null,
    })),
    testSentAt: campaign.testSentAt ? campaign.testSentAt.toISOString() : null,
  };
  return { context, inboxes, facts };
}

/** The saved email, checked: content rules for every version + the inboxes' signatures. */
function savedItems(
  campaign: CampaignForReadiness,
  context: ReadinessContext,
  inboxes: ReadinessInbox[],
) {
  const templates = campaignTemplates(campaign);
  return {
    templates,
    items: [...checkCampaignContent(templates, context), ...checkSenders(templates, inboxes)],
  };
}

/**
 * Must-fix problems as sentences (empty = ready). Start and Resume refuse when this is not empty,
 * so the rules hold even if the browser is bypassed. `skipChecks` leaves out rules the caller already
 * reports in its own words (Start: empty subject/body).
 */
export async function readinessMustFix(
  campaign: CampaignForReadiness,
  options: { skipChecks?: string[] } = {},
): Promise<string[]> {
  const { context, inboxes, facts } = await gather(campaign);
  const { templates, items } = savedItems(campaign, context, inboxes);
  const blocking: ReadinessItem[] = [...items, ...checkSetup(facts)].filter(
    (i) => !options.skipChecks?.includes(i.check),
  );
  return mustFixMessages(blocking, templates);
}

export async function getCampaignReadiness(id: string): Promise<CampaignReadinessDTO> {
  await connectDB();
  const campaign = await Campaign.findOne(notDeleted({ _id: id })).lean<CampaignForReadiness>();
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  const { context, inboxes, facts } = await gather(campaign);
  return {
    context,
    inboxes,
    setup: checkSetup(facts),
    saved: savedItems(campaign, context, inboxes).items,
    testSentAt: facts.testSentAt,
  };
}
