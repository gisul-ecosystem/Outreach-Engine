import { GlobeIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function DomainsPage() {
  return (
    <>
      <PageHeader
        title="Domains"
        description="Sending domains and their DNS health (SPF, DKIM, DMARC, MX)."
      />
      <EmptyState
        icon={GlobeIcon}
        title="No domains yet"
        description="Sending domains you add will be listed here."
      />
    </>
  );
}
