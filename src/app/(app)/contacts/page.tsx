import { UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export default function ContactsPage() {
  return (
    <>
      <PageHeader
        title="Contacts"
        description="Contacts, lists and the suppression list (people we never email)."
      />
      <EmptyState
        icon={UsersIcon}
        title="No contacts yet"
        description="Contacts you import from CSV will be listed here."
      />
    </>
  );
}
