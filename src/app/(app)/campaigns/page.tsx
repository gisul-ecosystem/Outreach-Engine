import { SendIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function CampaignsPage() {
  return (
    <>
      <PageHeader title="Campaigns" description="Write emails and send them to a contact list." />
      <EmptyState
        icon={SendIcon}
        title="No campaigns yet"
        description="Campaigns you create will be listed here."
      />
    </>
  );
}
