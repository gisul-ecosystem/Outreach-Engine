import { randomUUID } from "node:crypto";
import { createLogger } from "@/server/lib/logger";
import { newMessageId } from "@/server/lib/mime";
import {
  ProviderError,
  type CheckResult,
  type EmailProvider,
  type MailboxInfo,
  type ReceivedEmail,
  type SendFormat,
  type SendInput,
  type SendResult,
} from "./types";

const log = createLogger("fake-provider");

/**
 * Used whenever DRY_RUN=true: NOTHING is really sent.
 * Waits 200–800 ms like a real API, logs the email, and fails ~3% of the time with a
 * transient error so retries can be tested (BUILD_PLAN section 7).
 * Takes the same input as the real provider and logs which format it would have used.
 */
export class FakeProvider implements EmailProvider {
  constructor(
    private readonly options: {
      failureRate?: number;
      minDelayMs?: number;
      maxDelayMs?: number;
      random?: () => number;
      sendFormat?: SendFormat;
    } = {},
  ) {}

  private get random() {
    return this.options.random ?? Math.random;
  }

  private async delay() {
    const min = this.options.minDelayMs ?? 200;
    const max = this.options.maxDelayMs ?? 800;
    const ms = min + Math.floor(this.random() * (max - min + 1));
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async verifyConnection(): Promise<CheckResult> {
    return { ok: true };
  }

  async verifyMailbox(): Promise<CheckResult> {
    return { ok: true };
  }

  async listMailboxes(domain: string): Promise<MailboxInfo[]> {
    return ["sales", "hello", "team"].map((name) => ({
      email: `${name}@${domain}`,
      displayName: `${name[0].toUpperCase()}${name.slice(1)} (demo)`,
      enabled: true,
    }));
  }

  /** Nothing is really sent in a dry run, so nothing ever comes back. */
  async listReceivedEmails(): Promise<ReceivedEmail[]> {
    return [];
  }

  async send(input: SendInput): Promise<SendResult> {
    await this.delay();
    if (this.random() < (this.options.failureRate ?? 0.03)) {
      log.warn(`[DRY RUN] simulated temporary failure sending to ${input.to}`);
      throw new ProviderError("transient", "FAKE_TRANSIENT", "Simulated temporary failure", {
        retryAfterSeconds: 60,
      });
    }
    const providerMessageId = `fake-${randomUUID()}`;
    const format = this.options.sendFormat ?? "mime";
    const threaded = format === "outlook" && !!(input.inReplyTo || input.parentProviderMessageId);
    const how =
      format === "outlook"
        ? `Outlook format (JSON${threaded ? ", reply in the first email's thread" : ""})`
        : "MIME format";
    log.info(
      `[DRY RUN] not really sent (${how}): from=${input.from} to=${input.to} subject="${input.subject}" id=${providerMessageId}`,
    );
    return {
      providerMessageId,
      // Outlook format: in a real send Microsoft makes the Message-ID; here a pretend one is made.
      internetMessageId:
        format === "outlook"
          ? newMessageId(input.from)
          : (input.messageId ?? newMessageId(input.from)),
      format,
      ...(format === "outlook" ? { threaded } : {}),
    };
  }
}
