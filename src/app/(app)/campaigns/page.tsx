import { CampaignsList } from "@/components/campaigns/campaigns-list";
import { PageHeader } from "@/components/layout/page-header";

export default function CampaignsPage() {
  return (
    <>
      <PageHeader title="Campaigns" description="Write emails and send them to a contact list." />
      <CampaignsList />
    </>
  );
}
