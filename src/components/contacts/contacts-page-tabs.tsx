"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContactsTab } from "./contacts-tab";
import { ListsTab } from "./lists-tab";
import { SuppressionsTab } from "./suppressions-tab";

export function ContactsPageTabs() {
  return (
    <Tabs defaultValue="contacts" className="gap-4">
      <TabsList>
        <TabsTrigger value="contacts">Contacts</TabsTrigger>
        <TabsTrigger value="lists">Lists</TabsTrigger>
        <TabsTrigger value="suppressions">Suppressions</TabsTrigger>
      </TabsList>
      <TabsContent value="contacts">
        <ContactsTab />
      </TabsContent>
      <TabsContent value="lists">
        <ListsTab />
      </TabsContent>
      <TabsContent value="suppressions">
        <SuppressionsTab />
      </TabsContent>
    </Tabs>
  );
}
