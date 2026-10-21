import { randomUUID } from "node:crypto";
import { createLogger } from "@/server/lib/logger";
import {
  ProviderError,
  type CheckResult,
  type EmailProvider,
  type MailboxInfo,
  type SendInput,
} from "./types";

const log = createLogger("fake-provider");

/**
 * Used whenever DRY_RUN=true: NOTHING is really sent.
 * Waits 200–800 ms like a real API, logs the email, and fails ~3% of the time with a
 * transient error so retries can be tested (BUILD_PLAN section 7).
 */
export class FakeProvider implements EmailProvider {
  constructor(
    private readonly options: {
      failureRate?: number;
      minDelayMs?: number;
      maxDelayMs?: number;
      random?: () => number;
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

  async send(input: SendInput) {
    await this.delay();
    if (this.random() < (this.options.failureRate ?? 0.03)) {
      log.warn(`[DRY RUN] simulated temporary failure sending to ${input.to}`);
      throw new ProviderError("transient", "FAKE_TRANSIENT", "Simulated temporary failure", {
        retryAfterSeconds: 60,
      });
    }
    const providerMessageId = `fake-${randomUUID()}`;
    log.info(
      `[DRY RUN] not really sent: from=${input.from} to=${input.to} subject="${input.subject}" id=${providerMessageId}`,
    );
    return { providerMessageId };
  }
}
