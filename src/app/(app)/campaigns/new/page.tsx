import { CampaignWizard } from "@/components/campaigns/campaign-wizard";
import { PageHeader } from "@/components/layout/page-header";

export default function NewCampaignPage() {
  return (
    <>
      <PageHeader
        title="New campaign"
        description="Five short steps. Your draft is saved as you go; nothing is sent until you press Start."
      />
      <CampaignWizard />
    </>
  );
}
