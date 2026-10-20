import { LayoutDashboardIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Live sending progress across all inboxes." />
      <EmptyState
        icon={LayoutDashboardIcon}
        title="Nothing to show yet"
        description="Stats, the send queue and per-inbox progress will appear here once campaigns are running."
      />
    </>
  );
}
