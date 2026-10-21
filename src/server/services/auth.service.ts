import { isValidObjectId } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { User } from "@/server/db/models";
import { ApiError } from "@/server/lib/errors";
import { hashPassword, verifyPassword } from "@/server/lib/password";
import { normalizeEmail } from "@/shared/email";
import type { AuthUser, LoginInput } from "@/shared/auth";

const INVALID_CREDENTIALS = "Invalid email or password";

// Compared against when the email does not exist, so a wrong email takes as long as a wrong password
// (otherwise response time would reveal which emails have accounts).
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password"));

type UserLike = { _id: unknown; email: string; name?: string | null; role?: string | null };

function toAuthUser(user: UserLike): AuthUser {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name ?? "",
    role: user.role === "admin" ? "admin" : "member",
  };
}

/** Checks email + password. Wrong email and wrong password give the same error. */
export async function login({ email, password }: LoginInput): Promise<AuthUser> {
  await connectDB();
  const user = await User.findOne({ email: normalizeEmail(email) })
    .select("+passwordHash")
    .lean();

  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) {
    throw new ApiError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS);
  }
  return toAuthUser(user);
}

/** Loads the user for a session; null if the user no longer exists. */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  if (!isValidObjectId(userId)) return null;
  await connectDB();
  const user = await User.findById(userId).lean();
  return user ? toAuthUser(user) : null;
}
