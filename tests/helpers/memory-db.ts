import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { allModels } from "@/server/db/models";

let server: MongoMemoryServer | undefined;

/** Starts a throwaway in-memory MongoDB, connects Mongoose to it and builds all model indexes. */
export async function startMemoryDb() {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { dbName: "outreach-test" });
  await Promise.all(allModels.map((model) => model.syncIndexes()));
}

export async function stopMemoryDb() {
  await mongoose.disconnect();
  await server?.stop();
  server = undefined;
}

/** Empties every collection (indexes are kept). */
export async function clearMemoryDb() {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}
