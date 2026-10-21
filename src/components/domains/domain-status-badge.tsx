import { Badge } from "@/components/ui/badge";
import type { DomainStatus } from "@/shared/enums";

export function DomainStatusBadge({ status }: { status: DomainStatus }) {
  return status === "active" ? (
    <Badge variant="secondary">Active</Badge>
  ) : (
    <Badge variant="outline">Paused</Badge>
  );
}
