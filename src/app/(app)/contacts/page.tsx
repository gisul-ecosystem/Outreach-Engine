import { ContactsPageTabs } from "@/components/contacts/contacts-page-tabs";
import { PageHeader } from "@/components/layout/page-header";

export default function ContactsPage() {
  return (
    <>
      <PageHeader
        title="Contacts"
        description="Your contacts, the lists campaigns send to, and the suppression list (people we never email)."
      />
      <ContactsPageTabs />
    </>
  );
}
