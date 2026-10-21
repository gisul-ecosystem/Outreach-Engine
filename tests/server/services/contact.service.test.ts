import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Contact, List, Suppression } from "@/server/db/models";
import {
  confirmImport,
  deleteContact,
  listContacts,
  previewImport,
  updateContact,
} from "@/server/services/contact.service";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

const CSV = [
  "Email,First Name,Last Name,Company,Job Title,City",
  "ann@acme.com,Ann,Lee,Acme,CEO,Pune",
  "bob@beta.io,Bob,,Beta,,Delhi",
  "not-an-email,Bad,,,,",
  "ANN@acme.com,Annie,,,,",
  "carol@gamma.dev,Carol,King,Gamma,CTO,",
].join("\n");

const MAPPING = {
  Email: "email",
  "First Name": "firstName",
  "Last Name": "lastName",
  Company: "company",
  "Job Title": "title",
  City: "custom",
} as const;

let listId: string;

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  listId = String((await List.create({ name: "Leads" }))._id);
});

describe("CSV import", () => {
  it("preview returns columns, rows and a suggested mapping (nothing saved)", async () => {
    const preview = previewImport(CSV);
    expect(preview.columns).toHaveLength(6);
    expect(preview.totalRows).toBe(5);
    expect(preview.suggestedMapping).toEqual(MAPPING);
    expect(await Contact.countDocuments()).toBe(0);
  });

  it("imports with a full report", async () => {
    const report = await confirmImport(CSV, MAPPING, listId);
    expect(report).toMatchObject({
      total: 5,
      created: 3,
      updated: 0,
      duplicatesInFile: 1,
      invalid: 1,
      suppressed: 0,
    });
    expect(report.invalidRows).toEqual([
      { row: 4, email: "not-an-email", reason: "Not a valid email address" },
    ]);
    const ann = await Contact.findOne({ email: "ann@acme.com" }).lean();
    expect(ann).toMatchObject({ firstName: "Ann", lastName: "Lee", company: "Acme", title: "CEO" });
    const annDoc = await Contact.findOne({ email: "ann@acme.com" });
    expect(annDoc?.custom?.get("city")).toBe("Pune");
    expect(ann?.listIds.map(String)).toEqual([listId]);
  });

  it("importing the same file twice creates no duplicates (0 created the second time)", async () => {
    await confirmImport(CSV, MAPPING, listId);
    const second = await confirmImport(CSV, MAPPING, listId);
    expect(second).toMatchObject({ created: 0, updated: 3 });
    expect(await Contact.countDocuments()).toBe(3);
    const ann = await Contact.findOne({ email: "ann@acme.com" }).lean();
    expect(ann?.listIds).toHaveLength(1); // the list is not added twice
  });

  it("adds the new list to existing contacts and never blanks a filled field", async () => {
    await confirmImport(CSV, MAPPING, listId);
    const otherList = String((await List.create({ name: "Event" }))._id);
    await confirmImport(
      "Email,First Name,Company\nann@acme.com,,NewCo\n",
      {
        Email: "email",
        "First Name": "firstName",
        Company: "company",
      },
      otherList,
    );

    const ann = await Contact.findOne({ email: "ann@acme.com" }).lean();
    expect(ann?.firstName).toBe("Ann"); // empty value did not overwrite
    expect(ann?.company).toBe("NewCo"); // non-empty value updated
    expect(ann?.listIds.map(String).sort()).toEqual([listId, otherList].sort());
  });

  it("marks suppressed emails on import (new and existing contacts)", async () => {
    await Contact.create({ email: "carol@gamma.dev", status: "active" });
    await Suppression.create([
      { email: "bob@beta.io", reason: "bounced" },
      { email: "carol@gamma.dev", reason: "unsubscribed" },
    ]);
    const report = await confirmImport(CSV, MAPPING, listId);
    expect(report.suppressed).toBe(2);
    expect((await Contact.findOne({ email: "bob@beta.io" }).lean())?.status).toBe("bounced");
    expect((await Contact.findOne({ email: "carol@gamma.dev" }).lean())?.status).toBe(
      "unsubscribed",
    );
    expect((await Contact.findOne({ email: "ann@acme.com" }).lean())?.status).toBe("active");
  });

  it("restores a deleted contact that is imported again", async () => {
    await confirmImport(CSV, MAPPING, listId);
    const ann = await Contact.findOne({ email: "ann@acme.com" }).lean();
    await deleteContact(String(ann!._id));
    await confirmImport(CSV, MAPPING, listId);
    expect((await Contact.findById(ann!._id).lean())?.deletedAt).toBeNull();
  });

  it("rejects an unknown list and a mapping for columns not in the file", async () => {
    await expect(confirmImport(CSV, MAPPING, "652f0c0c0c0c0c0c0c0c0c0c")).rejects.toMatchObject({
      status: 404,
    });
    await expect(confirmImport(CSV, { ...MAPPING, Phone: "custom" }, listId)).rejects.toMatchObject(
      { code: "MAPPING_MISMATCH" },
    );
  });
});

describe("contacts API service", () => {
  beforeEach(() => confirmImport(CSV, MAPPING, listId));

  it("searches email/name/company, filters by list and status, paginates", async () => {
    expect((await listContacts({ page: 1, limit: 20, search: "gamma" })).total).toBe(1);
    expect((await listContacts({ page: 1, limit: 20, search: "ann" })).data[0].email).toBe(
      "ann@acme.com",
    );
    expect((await listContacts({ page: 1, limit: 20, listId })).total).toBe(3);
    expect((await listContacts({ page: 1, limit: 2 })).data).toHaveLength(2);
    await Contact.updateOne({ email: "bob@beta.io" }, { status: "bounced" });
    expect((await listContacts({ page: 1, limit: 20, status: "bounced" })).total).toBe(1);
  });

  it("flags suppressed contacts in the list", async () => {
    await Suppression.create({ email: "bob@beta.io", reason: "manual" });
    const page = await listContacts({ page: 1, limit: 20, search: "bob" });
    expect(page.data[0].suppressed).toBe(true);
  });

  it("cannot make a suppressed contact active", async () => {
    const bob = await Contact.findOne({ email: "bob@beta.io" }).lean();
    await Suppression.create({ email: "bob@beta.io", reason: "unsubscribed" });
    await expect(updateContact(String(bob!._id), { status: "active" })).rejects.toMatchObject({
      status: 409,
      code: "SUPPRESSED",
    });
  });

  it("edits fields and soft-deletes", async () => {
    const bob = await Contact.findOne({ email: "bob@beta.io" }).lean();
    const updated = await updateContact(String(bob!._id), { lastName: "Brown" });
    expect(updated.lastName).toBe("Brown");
    await deleteContact(String(bob!._id));
    expect((await listContacts({ page: 1, limit: 20 })).total).toBe(2);
    expect(await Contact.countDocuments()).toBe(3);
  });
});
