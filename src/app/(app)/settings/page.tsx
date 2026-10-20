import { SettingsIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Timezone and default sending limits." />
      <EmptyState
        icon={SettingsIcon}
        title="Settings coming soon"
        description="Timezone, default daily limits and gaps will be editable here."
      />
    </>
  );
}
