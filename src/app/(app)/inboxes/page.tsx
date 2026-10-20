import { InboxIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function InboxesPage() {
  return (
    <>
      <PageHeader
        title="Inboxes"
        description="Mailboxes that send emails, with their daily limits and gaps."
      />
      <EmptyState
        icon={InboxIcon}
        title="No inboxes yet"
        description="Sending inboxes you add will be listed here."
      />
    </>
  );
}
