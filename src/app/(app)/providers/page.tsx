import { PlugZapIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function ProvidersPage() {
  return (
    <>
      <PageHeader
        title="Providers"
        description="Connections to Microsoft 365 (and later Google Workspace)."
      />
      <EmptyState
        icon={PlugZapIcon}
        title="No provider connections yet"
        description="Microsoft 365 connections you add will be listed here."
      />
    </>
  );
}
