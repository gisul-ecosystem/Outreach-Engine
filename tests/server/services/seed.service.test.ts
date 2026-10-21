import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Settings, User } from "@/server/db/models";
import { verifyPassword } from "@/server/lib/password";
import { resetAdminPassword, seedDatabase } from "@/server/services/seed.service";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

const input = { adminEmail: " Admin@Racko.IN ", adminPassword: "correct-horse-1" };

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

describe("seedDatabase", () => {
  it("creates the admin user (hashed password) and the settings document", async () => {
    const result = await seedDatabase(input);
    expect(result).toEqual({ admin: "created", settings: "created" });

    const user = await User.findOne({ email: "admin@racko.in" }).select("+passwordHash").lean();
    expect(user?.role).toBe("admin");
    expect(user?.passwordHash).not.toBe(input.adminPassword);
    expect(await verifyPassword(input.adminPassword, user!.passwordHash)).toBe(true);

    const settings = await Settings.findOne().lean();
    expect(settings?.timezone).toBe("Asia/Kolkata");
  });

  it("is idempotent: running twice changes nothing", async () => {
    await seedDatabase(input);
    const userBefore = await User.findOne().select("+passwordHash").lean();
    const settingsBefore = await Settings.findOne().lean();

    const second = await seedDatabase({ ...input, adminPassword: "a-different-password" });
    expect(second).toEqual({ admin: "already-exists", settings: "already-exists" });

    expect(await User.countDocuments()).toBe(1);
    expect(await Settings.countDocuments()).toBe(1);
    expect(await User.findOne().select("+passwordHash").lean()).toEqual(userBefore);
    expect(await Settings.findOne().lean()).toEqual(settingsBefore);
  });
});

describe("resetAdminPassword", () => {
  it("replaces the existing user's password", async () => {
    await seedDatabase(input);
    const result = await resetAdminPassword({ ...input, adminPassword: "a-new-password" });
    expect(result).toBe("updated");

    const user = await User.findOne().select("+passwordHash").lean();
    expect(await verifyPassword("a-new-password", user!.passwordHash)).toBe(true);
    expect(await verifyPassword(input.adminPassword, user!.passwordHash)).toBe(false);
  });

  it("does not create a user that does not exist", async () => {
    expect(await resetAdminPassword(input)).toBe("not-found");
    expect(await User.countDocuments()).toBe(0);
  });
});
