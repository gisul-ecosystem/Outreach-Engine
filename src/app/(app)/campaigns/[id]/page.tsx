import { CampaignDetail } from "@/components/campaigns/campaign-detail";

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  const { id } = await params;
  return <CampaignDetail id={id} />;
}
