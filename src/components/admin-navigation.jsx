"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  FileClock,
  Flag,
  Gavel,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Users,
} from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import { cn } from "@/lib/utils";

export function getAdminNavigationItems(role, t) {
  return [
    {
      key: "overview",
      label: t.adminNavOverview,
      href: "/admin",
      icon: LayoutDashboard,
      action: MODERATION_ACTIONS.viewDashboard,
      exact: true,
    },
    {
      key: "reports",
      label: t.adminNavReports,
      href: "/admin/reports",
      icon: Flag,
      action: MODERATION_ACTIONS.readReports,
    },
    {
      key: "listings",
      label: t.adminNavListings,
      href: "/admin/listings",
      icon: ClipboardCheck,
      action: MODERATION_ACTIONS.readListings,
    },
    {
      key: "enforcement",
      label: t.adminNavEnforcement,
      href: "/admin/enforcement",
      icon: Gavel,
      action: MODERATION_ACTIONS.readUsers,
    },
    {
      key: "users",
      label: t.adminNavUsers,
      href: "/admin/users",
      icon: Users,
      action: MODERATION_ACTIONS.readUsers,
      roles: ["admin"],
    },
    {
      key: "conversations",
      label: t.adminNavConversations,
      href: "/admin/conversations",
      icon: MessagesSquare,
      action: MODERATION_ACTIONS.readConversations,
    },
    {
      key: "announcements",
      label: t.adminNavAnnouncements,
      href: "/admin/announcements",
      icon: Megaphone,
      action: MODERATION_ACTIONS.manageAnnouncements,
    },
    {
      key: "audit",
      label: t.adminNavAudit,
      href: "/admin/audit",
      icon: FileClock,
      action: MODERATION_ACTIONS.readAuditLog,
    },
  ].filter(
    (item) =>
      canPerformModerationAction(role, item.action) &&
      (!item.roles || item.roles.includes(role)),
  );
}

export function AdminNavigation({ role }) {
  const pathname = usePathname() ?? "/admin";
  const { t } = useLanguage();
  const items = getAdminNavigationItems(role, t);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={t.adminNavigationLabel}
      className="border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:px-5"
    >
      <div className="mx-auto flex w-full max-w-[1360px] gap-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active && "bg-foreground text-background hover:bg-foreground hover:text-background",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
