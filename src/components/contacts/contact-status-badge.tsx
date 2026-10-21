import { Badge } from "@/components/ui/badge";
import type { ContactStatus } from "@/shared/enums";

const STYLES: Record<ContactStatus, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  unsubscribed: {
    label: "Unsubscribed",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  bounced: {
    label: "Bounced",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
};

export function ContactStatusBadge({
  status,
  suppressed,
}: {
  status: ContactStatus;
  suppressed?: boolean;
}) {
  const { label, className } = STYLES[status];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge className={className}>{label}</Badge>
      {suppressed && <Badge variant="outline">Suppressed</Badge>}
    </span>
  );
}
