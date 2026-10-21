import { CampaignEdit } from "@/components/campaigns/campaign-edit";
import { PageHeader } from "@/components/layout/page-header";

export default async function EditCampaignPage({ params }: PageProps<"/campaigns/[id]/edit">) {
  const { id } = await params;
  return (
    <>
      <PageHeader
        title="Edit campaign"
        description="Your changes are saved when you press Next or Save."
      />
      <CampaignEdit id={id} />
    </>
  );
}
