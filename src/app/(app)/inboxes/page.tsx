import { InboxesTable } from "@/components/inboxes/inboxes-table";
import { PageHeader } from "@/components/layout/page-header";

export default function InboxesPage() {
  return (
    <>
      <PageHeader
        title="Inboxes"
        description="Mailboxes that send your campaigns, each with its own daily limit and random gap."
      />
      <InboxesTable />
    </>
  );
}
