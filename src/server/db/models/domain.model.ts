import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DNS_CHECK_RESULTS, DOMAIN_STATUSES } from "@/shared/enums";
import { deletedAtField, onlyNotDeleted } from "@/server/db/soft-delete";

const dnsResult = { type: String, enum: DNS_CHECK_RESULTS, default: "unknown" } as const;

const domainSchema = new Schema(
  {
    name: { type: String, required: true, lowercase: true, trim: true },
    providerConnectionId: { type: Schema.Types.ObjectId, ref: "ProviderConnection", default: null },
    status: { type: String, enum: DOMAIN_STATUSES, default: "active" },
    dns: {
      spf: dnsResult,
      dkim: dnsResult,
      dmarc: dnsResult,
      mx: dnsResult,
      // Raw DNS records found for each check (shown in the UI tooltips)
      records: {
        spf: { type: [String], default: [] },
        dkim: { type: [String], default: [] },
        dmarc: { type: [String], default: [] },
        mx: { type: [String], default: [] },
      },
      checkedAt: { type: Date, default: null },
    },
    /**
     * Host of the tracking links for emails sent from this domain, e.g. "go.tryracko.in"
     * (the domain itself or one of its subdomains). null = links use TRACKING_BASE_URL.
     */
    trackingHost: { type: String, default: null, lowercase: true, trim: true },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "domains" },
);

domainSchema.index({ name: 1 }, { unique: true, ...onlyNotDeleted });

export type DomainDoc = InferSchemaType<typeof domainSchema>;
export const Domain: Model<DomainDoc> =
  (mongoose.models.Domain as Model<DomainDoc>) || mongoose.model<DomainDoc>("Domain", domainSchema);
