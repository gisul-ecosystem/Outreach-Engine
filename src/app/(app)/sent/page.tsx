import { PageHeader } from "@/components/layout/page-header";
import { SentPageTabs } from "@/components/sent-emails/sent-page-tabs";

export default function SentEmailsPage() {
  return (
    <>
      <PageHeader
        title="Sent emails"
        description="Every email sent from your connected inboxes — including the ones you type by hand in Outlook — with replies and link clicks."
      />
      <SentPageTabs />
    </>
  );
}
