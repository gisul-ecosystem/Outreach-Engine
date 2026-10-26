import { z } from "zod";
import { paginationSchema } from "./common";

export const createListSchema = z.object({
  name: z.string().trim().min(1, "Enter a list name").max(100, "Name is too long"),
  description: z.string().trim().max(500, "Description is too long").default(""),
});
export type CreateListInput = z.input<typeof createListSchema>;

export const updateListSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a list name").max(100, "Name is too long").optional(),
    description: z.string().trim().max(500, "Description is too long").optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, "Nothing to update");
export type UpdateListInput = z.input<typeof updateListSchema>;

export const listListsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
});

export type ListDTO = {
  id: string;
  name: string;
  description: string;
  contactCount: number;
  /** Last tracking-link choice (import / links download); null = none yet. */
  linkDestinationUrl: string | null;
  linkDomainId: string | null;
  createdAt: string;
  updatedAt: string;
};
