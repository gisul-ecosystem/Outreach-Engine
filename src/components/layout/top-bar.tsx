"use client";

import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/auth/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NAV_ITEMS, isNavItemActive } from "./nav-items";

export function TopBar() {
  const pathname = usePathname();
  const current = NAV_ITEMS.find((item) => isNavItemActive(item, pathname));

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <h1 className="text-sm font-medium">{current?.title ?? "Outreach Engine"}</h1>
      <UserMenu />
    </header>
  );
}
