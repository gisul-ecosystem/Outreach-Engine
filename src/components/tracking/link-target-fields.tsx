"use client";

import { SimpleSelect } from "@/components/common/simple-select";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { TrackingConfigDTO } from "@/shared/tracking";

/** What the person typed: a path ("/pricing") or a full address, and the sending domain ("" = default). */
export type LinkTarget = { path: string; domainId: string };

export const EMPTY_LINK_TARGET: LinkTarget = { path: "", domainId: "" };

const DEFAULT_DOMAIN = "default";

/** "/pricing" → "https://racko.ai/pricing"; empty → the homepage; a full address stays as it is. */
export function destinationOf(path: string, homepage: string): string {
  try {
    return path.trim() ? new URL(path.trim(), homepage).toString() : homepage;
  } catch {
    return homepage; // an unfinished address: the server checks the final one anyway
  }
}

/**
 * Starting values from a saved choice (e.g. a list's last links download). A saved domain whose
 * tracking address was removed falls back to the default.
 */
export function savedLinkTarget(
  saved: { destinationUrl: string | null; domainId: string | null },
  config: TrackingConfigDTO | undefined,
): LinkTarget {
  let path = "";
  if (saved.destinationUrl && config) {
    const destination = new URL(saved.destinationUrl);
    if (destination.origin !== new URL(config.homepage).origin) {
      path = saved.destinationUrl;
    } else {
      const rest = destination.pathname + destination.search + destination.hash;
      path = rest === "/" ? "" : rest;
    }
  }
  const domainId = config?.domains.some((d) => d.id === saved.domainId) ? saved.domainId! : "";
  return { path, domainId };
}

/** Start of the links for this choice, e.g. https://go.tryracko.in */
export function linkBaseOf(target: LinkTarget, config: TrackingConfigDTO | undefined): string {
  const domain = config?.domains.find((d) => d.id === target.domainId);
  return domain ? `https://${domain.trackingHost}` : (config?.baseUrl ?? "");
}

/** Where the links lead + which sending domain they are for, with a preview of the link. */
export function LinkTargetFields({
  id,
  value,
  onChange,
  config,
}: {
  id: string;
  value: LinkTarget;
  onChange: (value: LinkTarget) => void;
  config: TrackingConfigDTO | undefined;
}) {
  const homepage = config?.homepage ?? "";
  const defaultHost = config ? new URL(config.baseUrl).host : "…";
  const options = [
    { value: DEFAULT_DOMAIN, label: `Default (${defaultHost})` },
    ...(config?.domains ?? []).map((d) => ({ value: d.id, label: `${d.name} → ${d.trackingHost}` })),
  ];

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${id}-path`}>Link leads to</FieldLabel>
        <div className="flex items-center gap-1 text-sm">
          <span className="shrink-0 text-muted-foreground">{homepage || "…"}</span>
          <Input
            id={`${id}-path`}
            placeholder="/pricing (optional)"
            value={value.path}
            onChange={(e) => onChange({ ...value, path: e.target.value })}
          />
        </div>
        <FieldDescription>
          Leave empty for the homepage, type a page like /pricing, or paste a full address on{" "}
          {(config?.allowedHosts ?? []).join(", ") || "an allowed site"}.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-domain`}>Sending from</FieldLabel>
        <SimpleSelect
          id={`${id}-domain`}
          value={value.domainId || DEFAULT_DOMAIN}
          onChange={(next) => onChange({ ...value, domainId: next === DEFAULT_DOMAIN ? "" : next })}
          options={options}
        />
        <FieldDescription>
          The domain of the inbox you will send from. Its links use that domain&apos;s tracking
          address, so they match the email.
          {config && config.domains.length === 0 &&
            " No domain has a tracking address yet — set one on the Domains page."}
        </FieldDescription>
      </Field>
      <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
        {linkBaseOf(value, config)}/r/<span className="text-muted-foreground">abc123…</span> →{" "}
        {destinationOf(value.path, homepage)}
      </p>
    </>
  );
}
