"use client";

import { ClicksView } from "@/components/tracking/clicks-view";
import { LocalLinksBanner } from "@/components/tracking/local-links-banner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SentEmailsView } from "./sent-emails-view";

export function SentPageTabs() {
  return (
    <div className="flex flex-col gap-4">
      <LocalLinksBanner />
      <Tabs defaultValue="emails" className="gap-4">
        <TabsList>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="clicks">Link clicks</TabsTrigger>
        </TabsList>
        <TabsContent value="emails">
          <SentEmailsView />
        </TabsContent>
        <TabsContent value="clicks">
          <ClicksView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
