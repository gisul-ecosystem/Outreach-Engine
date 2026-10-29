import { PageHeader } from "@/components/layout/page-header";
import { IncomingEmailsView } from "@/components/incoming-emails/incoming-emails-view";

export default function InboxPage() {
  return (
    <>
      <PageHeader
        title="Inbox"
        description="Every email that arrived in your connected inboxes — replies, bounces, auto-replies and everything else."
      />
      <IncomingEmailsView />
    </>
  );
}
