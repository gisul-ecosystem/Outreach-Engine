import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Contact, Suppression } from "@/server/db/models";
import { createList, deleteList, listLists, updateList } from "@/server/services/list.service";
import {
  createSuppression,
  deleteSuppression,
  importSuppressions,
  listSuppressions,
} from "@/server/services/suppression.service";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

describe("lists", () => {
  it("creates, renames, counts contacts and soft-deletes", async () => {
    const list = await createList({ name: "Leads", description: "" });
    await Contact.create([
      { email: "a@x.com", listIds: [list.id] },
      { email: "b@x.com", listIds: [list.id] },
      { email: "c@x.com", listIds: [list.id], deletedAt: new Date() },
    ]);
    expect((await listLists({ page: 1, limit: 20 })).data[0]).toMatchObject({
      name: "Leads",
      contactCount: 2,
    });
    expect((await updateList(list.id, { name: "Hot leads" })).name).toBe("Hot leads");
    await deleteList(list.id);
    expect((await listLists({ page: 1, limit: 20 })).total).toBe(0);
  });

  it("rejects a duplicate name (any case)", async () => {
    await createList({ name: "Leads", description: "" });
    await expect(createList({ name: "LEADS", description: "" })).rejects.toMatchObject({
      status: 409,
      code: "LIST_EXISTS",
    });
  });
});

describe("suppressions", () => {
  it("adding a suppression updates the matching active contact", async () => {
    await Contact.create([{ email: "unsub@x.com" }, { email: "bounce@x.com" }]);
    await createSuppression({ email: "unsub@x.com", reason: "unsubscribed", note: "" });
    await createSuppression({ email: "bounce@x.com", reason: "bounced", note: "" });
    expect((await Contact.findOne({ email: "unsub@x.com" }).lean())?.status).toBe("unsubscribed");
    expect((await Contact.findOne({ email: "bounce@x.com" }).lean())?.status).toBe("bounced");
  });

  it("is unique: adding the same email twice → 409", async () => {
    await createSuppression({ email: "a@x.com", reason: "manual", note: "" });
    await expect(
      createSuppression({ email: "a@x.com", reason: "complaint", note: "" }),
    ).rejects.toMatchObject({ status: 409, code: "ALREADY_SUPPRESSED" });
  });

  it("imports a CSV with an email column", async () => {
    await Suppression.create({ email: "old@x.com", reason: "manual" });
    await Contact.create({ email: "lead@x.com" });
    const csv = "Name,Email\nA, Lead@X.com \nB,old@x.com\nC,lead@x.com\nD,broken\n";
    const report = await importSuppressions(csv, { reason: "unsubscribed", note: "from CRM" });
    expect(report).toEqual({
      total: 4,
      added: 1,
      alreadySuppressed: 1,
      duplicatesInFile: 1,
      invalid: 1,
      contactsUpdated: 1,
    });
    expect((await Suppression.findOne({ email: "old@x.com" }).lean())?.reason).toBe("manual");
    expect((await Contact.findOne({ email: "lead@x.com" }).lean())?.status).toBe("unsubscribed");
  });

  it("lists with search and deletes", async () => {
    const s = await createSuppression({ email: "find@me.com", reason: "manual", note: "" });
    await createSuppression({ email: "other@x.com", reason: "manual", note: "" });
    expect((await listSuppressions({ page: 1, limit: 20, search: "find" })).total).toBe(1);
    await deleteSuppression(s.id);
    expect((await listSuppressions({ page: 1, limit: 20 })).total).toBe(1);
  });
});
