import type { QueryFilter } from "mongoose";

/** Schema field used by every soft-deletable model (domains, inboxes, lists, contacts, campaigns, providers). */
export const deletedAtField = { type: Date, default: null } as const;

/**
 * Adds `deletedAt: null` to a query filter so normal queries skip soft-deleted documents.
 *
 *   Domain.find(notDeleted({ status: "active" }))
 *   Domain.findOne(notDeleted({ _id: id }))
 *
 * To include deleted documents (history, stats), query without this helper.
 */
export function notDeleted<T>(filter: QueryFilter<T> = {}): QueryFilter<T> {
  return { ...filter, deletedAt: null } as QueryFilter<T>;
}

/** Partial index option: uniqueness only applies to documents that are not soft-deleted. */
export const onlyNotDeleted = {
  partialFilterExpression: { deletedAt: { $type: "null" } },
} as const;
