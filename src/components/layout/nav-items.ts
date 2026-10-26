import {
  GlobeIcon,
  InboxIcon,
  LayoutDashboardIcon,
  MailCheckIcon,
  PlugZapIcon,
  SendIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { title: string; href: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboardIcon },
  { title: "Campaigns", href: "/campaigns", icon: SendIcon },
  { title: "Sent emails", href: "/sent", icon: MailCheckIcon },
  { title: "Contacts", href: "/contacts", icon: UsersIcon },
  { title: "Inboxes", href: "/inboxes", icon: InboxIcon },
  { title: "Domains", href: "/domains", icon: GlobeIcon },
  { title: "Providers", href: "/providers", icon: PlugZapIcon },
  { title: "Settings", href: "/settings", icon: SettingsIcon },
];

export function isNavItemActive(item: NavItem, pathname: string) {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
