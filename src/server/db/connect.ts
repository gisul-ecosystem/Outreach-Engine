import mongoose from "mongoose";
import { getEnv } from "@/server/config/env";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

// Stored on globalThis so Next.js hot reload reuses one connection instead of opening a new one per reload.
const globalForMongoose = globalThis as typeof globalThis & { _mongooseCache?: MongooseCache };
const cache: MongooseCache = (globalForMongoose._mongooseCache ??= { conn: null, promise: null });

mongoose.set("strictQuery", true);

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  cache.promise ??= mongoose.connect(getEnv().MONGODB_URI, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5_000,
  });

  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null; // allow the next call to retry
    throw err;
  }
  return cache.conn;
}

export async function disconnectDB(): Promise<void> {
  if (!cache.conn && !cache.promise) return;
  await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
}

/** Sends a ping to MongoDB. Throws if the database cannot be reached. */
export async function pingDB(): Promise<void> {
  const conn = await connectDB();
  const db = conn.connection.db;
  if (!db) throw new Error("MongoDB connection has no database handle");
  await db.admin().ping();
}
