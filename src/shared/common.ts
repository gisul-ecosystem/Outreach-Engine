import { z } from "zod";

/** `?page=1&limit=20` for every list endpoint (query strings are coerced to numbers). */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Shape of every list response: `{ data, page, limit, total }`. */
export type Paginated<T> = { data: T[]; page: number; limit: number; total: number };

/** A MongoDB id in a URL, e.g. /api/domains/<id>. */
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
export const idParamsSchema = z.object({ id: objectIdSchema });
