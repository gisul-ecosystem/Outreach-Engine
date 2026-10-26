import type { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Contact, List, type ListDoc } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { ApiError } from "@/server/lib/errors";
import { logEvent } from "@/server/services/event.service";
import type { Paginated } from "@/shared/common";
import type { ListDTO } from "@/shared/list";

type ListRecord = ListDoc & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toDTO(list: ListRecord, contactCount: number): ListDTO {
  return {
    id: String(list._id),
    name: list.name,
    description: list.description ?? "",
    contactCount,
    linkDestinationUrl: list.linkDestinationUrl ?? null,
    linkDomainId: list.linkDomainId ? String(list.linkDomainId) : null,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  };
}

/** Number of (non-deleted) contacts in each list. */
async function countContacts(listIds: Types.ObjectId[]) {
  const rows = await Contact.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { listIds: { $in: listIds }, deletedAt: null } },
    { $unwind: "$listIds" },
    { $match: { listIds: { $in: listIds } } },
    { $group: { _id: "$listIds", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

async function dto(list: ListRecord) {
  return toDTO(list, (await countContacts([list._id])).get(String(list._id)) ?? 0);
}

export async function findListOr404(id: string): Promise<ListRecord> {
  const list = await List.findOne(notDeleted({ _id: id })).lean<ListRecord>();
  if (!list) throw new ApiError(404, "LIST_NOT_FOUND", "List not found");
  return list;
}

async function assertNameFree(name: string, exceptId?: Types.ObjectId) {
  const filter: Record<string, unknown> = {
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
  };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await List.exists(notDeleted(filter))) {
    throw new ApiError(409, "LIST_EXISTS", `A list named "${name}" already exists`);
  }
}

export async function listLists(query: {
  page: number;
  limit: number;
  search?: string;
}): Promise<Paginated<ListDTO>> {
  await connectDB();
  const filter: Record<string, unknown> = {};
  if (query.search) filter.name = { $regex: escapeRegex(query.search), $options: "i" };
  const [lists, total] = await Promise.all([
    List.find(notDeleted(filter))
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<ListRecord[]>(),
    List.countDocuments(notDeleted(filter)),
  ]);
  const counts = await countContacts(lists.map((l) => l._id));
  return {
    data: lists.map((l) => toDTO(l, counts.get(String(l._id)) ?? 0)),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function getList(id: string): Promise<ListDTO> {
  await connectDB();
  return dto(await findListOr404(id));
}

export async function createList(input: { name: string; description: string }): Promise<ListDTO> {
  await connectDB();
  await assertNameFree(input.name);
  const created = await List.create(input);
  await logEvent("list.created", `List "${input.name}" created`);
  return getList(String(created._id));
}

export async function updateList(
  id: string,
  input: { name?: string; description?: string },
): Promise<ListDTO> {
  await connectDB();
  const list = await findListOr404(id);
  if (input.name !== undefined && input.name !== list.name) {
    await assertNameFree(input.name, list._id);
  }
  const update = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  await List.updateOne({ _id: list._id }, { $set: update });
  return getList(id);
}

/** Soft delete. Contacts stay (they may be in other lists); they just no longer show this list. */
export async function deleteList(id: string): Promise<{ id: string }> {
  await connectDB();
  const list = await findListOr404(id);
  await List.updateOne({ _id: list._id }, { $set: { deletedAt: new Date() } });
  await logEvent("list.deleted", `List "${list.name}" deleted`);
  return { id };
}
