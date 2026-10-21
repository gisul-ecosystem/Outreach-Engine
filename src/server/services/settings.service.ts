import { getEnv } from "@/server/config/env";
import { Settings } from "@/server/db/models";
import { DEFAULTS } from "@/shared/enums";

/**
 * The app timezone used for send windows, "today" and ETA dates:
 * the Settings document first, then APP_TIMEZONE from .env.local, then Asia/Kolkata.
 */
export async function getTimezone(): Promise<string> {
  const settings = await Settings.findOne().select("timezone").lean();
  if (settings?.timezone) return settings.timezone;
  try {
    return getEnv().APP_TIMEZONE;
  } catch {
    return DEFAULTS.timezone;
  }
}
