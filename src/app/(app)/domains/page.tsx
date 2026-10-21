import { DomainsTable } from "@/components/domains/domains-table";
import { PageHeader } from "@/components/layout/page-header";

export default function DomainsPage() {
  return (
    <>
      <PageHeader
        title="Domains"
        description="Sending domains and their DNS health (SPF, DKIM, DMARC, MX). Hover a badge to see the record."
      />
      <DomainsTable />
    </>
  );
}
