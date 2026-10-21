import { PageHeader } from "@/components/layout/page-header";
import { ProvidersList } from "@/components/providers/providers-list";

export default function ProvidersPage() {
  return (
    <>
      <PageHeader
        title="Providers"
        description="Connections to Microsoft 365. Inboxes send through these. (Google Workspace comes later.)"
      />
      <ProvidersList />
    </>
  );
}
