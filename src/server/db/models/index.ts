import { Campaign } from "./campaign.model";
import { Contact } from "./contact.model";
import { Domain } from "./domain.model";
import { Event } from "./event.model";
import { Inbox } from "./inbox.model";
import { List } from "./list.model";
import { Message } from "./message.model";
import { ProviderConnection } from "./provider-connection.model";
import { Settings } from "./settings.model";
import { Suppression } from "./suppression.model";
import { User } from "./user.model";

export * from "./campaign.model";
export * from "./contact.model";
export * from "./domain.model";
export * from "./event.model";
export * from "./inbox.model";
export * from "./list.model";
export * from "./message.model";
export * from "./provider-connection.model";
export * from "./settings.model";
export * from "./suppression.model";
export * from "./user.model";

/** Every model, used by `npm run db:indexes` and the database tests. */
export const allModels = [
  User,
  ProviderConnection,
  Domain,
  Inbox,
  List,
  Contact,
  Suppression,
  Campaign,
  Message,
  Event,
  Settings,
] as const;
