import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { User } from "@/server/db/models";
import { hashPassword } from "@/server/lib/password";
import { login } from "@/server/services/auth.service";
import { startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

beforeAll(async () => {
  await startMemoryDb();
  await User.create({
    email: "admin@racko.in",
    passwordHash: await hashPassword("right-password"),
    name: "Admin",
    role: "admin",
  });
});
afterAll(stopMemoryDb);

describe("login", () => {
  it("returns the user (without password hash) for the right password", async () => {
    const user = await login({ email: "admin@racko.in", password: "right-password" });
    expect(user).toMatchObject({ email: "admin@racko.in", name: "Admin", role: "admin" });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("accepts the email in any case / with spaces", async () => {
    await expect(
      login({ email: " ADMIN@Racko.in ", password: "right-password" }),
    ).resolves.toBeTruthy();
  });

  it("rejects a wrong password with the generic message", async () => {
    await expect(login({ email: "admin@racko.in", password: "wrong" })).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    });
  });

  it("rejects an unknown email with exactly the same error", async () => {
    await expect(
      login({ email: "nobody@racko.in", password: "right-password" }),
    ).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    });
  });
});
