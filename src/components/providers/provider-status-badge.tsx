import { Badge } from "@/components/ui/badge";
import type { ProviderStatus } from "@/shared/enums";

const LABELS: Record<ProviderStatus, { label: string; className: string }> = {
  connected: {
    label: "Connected",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  error: { label: "Error", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  unchecked: { label: "Not verified", className: "bg-muted text-muted-foreground" },
};

export function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
  const { label, className } = LABELS[status];
  return <Badge className={className}>{label}</Badge>;
}
