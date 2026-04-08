"use client";

import * as React from "react";
import { NavUser } from "@/components/nav-user";
import { SearchSidebarFilters } from "@/components/search-sidebar-filters";
import { SignOutButton } from "@/components/sign-out-button";
import { useLanguage } from "@/context/LanguageContext";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CATEGORIES } from "@/lib/categories";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  MESSAGE_NOTIFICATION_TYPE,
  isNotificationPreferencesTableMissing,
  normalizeMessageNotificationPreferences,
  subscribeToNotificationUpdates,
} from "@/lib/notifications";
import {
  ChevronRightIcon,
  FolderIcon,
  LayoutGridIcon,
  LayoutDashboardIcon,
  ListIcon,
  MessageSquareIcon,
  PlusSquareIcon,
  StarIcon,
  Settings2Icon,
  TerminalIcon,
  UserIcon,
  FileTextIcon,
} from "lucide-react";
import { getTranslatedCategoryTitle } from "@/lib/categories";
import { createClient } from "@/utils/supabase/client";

export function AppSidebar({ user, ...props }) {
  const supabase = React.useMemo(() => createClient(), []);
  const pathname = usePathname();
  const userId = user?.id ?? null;
  const categoriesOpen = pathname?.startsWith("/categories/") ?? false;
  const showLoggedInSections = Boolean(user);
  const { t, language } = useLanguage();
  const [hasUnreadNotifications, setHasUnreadNotifications] = React.useState(false);

  const fetchUnreadNotifications = React.useCallback(async () => {
    if (!userId) {
      setHasUnreadNotifications(false);
      return;
    }

    const { data: messageNotificationPreferencesRow, error: messageNotificationPreferencesError } =
      await supabase
        .from("notification_preferences")
        .select("email_enabled, in_app_enabled")
        .eq("user_id", userId)
        .eq("notification_type", MESSAGE_NOTIFICATION_TYPE)
        .maybeSingle();

    if (
      messageNotificationPreferencesError &&
      !isNotificationPreferencesTableMissing(messageNotificationPreferencesError)
    ) {
      console.error(
        "Failed to load sidebar notification preferences:",
        messageNotificationPreferencesError.message,
      );
    }

    const messageNotificationPreferences = normalizeMessageNotificationPreferences(
      messageNotificationPreferencesRow,
    );

    if (!messageNotificationPreferences.inApp) {
      setHasUnreadNotifications(false);
      return;
    }

    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("type", MESSAGE_NOTIFICATION_TYPE)
      .is("read_at", null);

    if (error) {
      console.error("Failed to load sidebar unread notifications count:", error.message);
      return;
    }

    setHasUnreadNotifications((count ?? 0) > 0);
  }, [supabase, userId]);

  React.useEffect(() => {
    fetchUnreadNotifications();
  }, [fetchUnreadNotifications]);

  React.useEffect(() => {
    if (!userId) {
      return undefined;
    }

    return subscribeToNotificationUpdates({
      supabase,
      userId,
      channelName: `sidebar-notifications-${userId}`,
      notificationPreferenceTypes: [MESSAGE_NOTIFICATION_TYPE],
      onChange: () => {
        fetchUnreadNotifications();
      },
    });
  }, [fetchUnreadNotifications, supabase, userId]);

  function renderMenuItemContent(item) {
    return (
      <>
        <item.icon />
        <span className="truncate">{item.title}</span>
      </>
    );
  }

  const navigationItems = [
    {
      title: t.browseListings,
      url: "/",
      icon: LayoutGridIcon,
    },
  ];

  const sellingItems = [
    {
      title: t.dashboard,
      url: "/dashboard",
      icon: LayoutDashboardIcon,
    },
    {
      title: t.createListing,
      url: "/listings/create",
      icon: PlusSquareIcon,
    },
    {
      title: t.myListings,
      url: "/dashboard?tab=all",
      icon: ListIcon,
    },
    {
      title: t.drafts,
      url: "/dashboard?tab=draft",
      icon: FileTextIcon,
    },
  ];

  const buyingItems = [
    {
      title: t.favourites,
      url: "/dashboard?tab=favourite",
      icon: StarIcon,
    },
    {
      title: t.messages,
      url: "/messages",
      icon: MessageSquareIcon,
      hasUnreadIndicator: hasUnreadNotifications,
    },
  ];

  const accountItems = [
    {
      title: t.profile,
      url: "/dashboard/profile",
      icon: UserIcon,
    },
    {
      title: t.settings,
      url: "/dashboard/settings",
      icon: Settings2Icon,
    },
  ];

  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
                  <TerminalIcon className="size-5" />
                </div>
                <div className="grid flex-1 text-left text-base leading-tight">
                  <span className="truncate font-semibold">
                    {t.studentMarket}
                  </span>
                  <span className="truncate text-sm text-sidebar-foreground/70">
                    {t.toronto}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SearchSidebarFilters />
        <SidebarGroup>
          <SidebarGroupLabel>{t.marketplace}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    className="min-h-11 rounded-xl px-3 text-sm"
                  >
                    <Link href={item.url} className="relative flex w-full items-center gap-2">
                      {renderMenuItemContent(item)}
                    </Link>
                  </SidebarMenuButton>
                  {item.hasUnreadIndicator ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-2 right-2 size-2.5 rounded-full bg-blue-500 ring-2 ring-sidebar shadow-[0_0_12px_rgba(59,130,246,0.95)]"
                    />
                  ) : null}
                </SidebarMenuItem>
              ))}

              <Collapsible asChild defaultOpen={categoriesOpen}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="lg"
                    tooltip={t.categories}
                    className="rounded-xl px-3 text-sm"
                  >
                    <>
                      <FolderIcon />
                      <span>{t.categories}</span>
                    </>
                  </SidebarMenuButton>

                  <CollapsibleTrigger asChild>
                    <SidebarMenuAction className="data-[state=open]:rotate-90">
                      <ChevronRightIcon />
                      <span className="sr-only">{t.toggleCategories}</span>
                    </SidebarMenuAction>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {CATEGORIES.map((category) => (
                        <SidebarMenuSubItem key={category.slug}>
                          <SidebarMenuSubButton asChild>
                            <Link href={`/categories/${category.slug}`}>
                              <span>{getTranslatedCategoryTitle(category.slug, t, language, category.title)}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showLoggedInSections ? (
          <SidebarGroup>
            <SidebarGroupLabel>{t.selling}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {sellingItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className="min-h-11 rounded-xl px-3 text-sm"
                    >
                      <Link href={item.url} className="relative flex w-full items-center gap-2">
                        {renderMenuItemContent(item)}
                      </Link>
                    </SidebarMenuButton>
                    {item.hasUnreadIndicator ? (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-2 right-2 size-2.5 rounded-full bg-blue-500 ring-2 ring-sidebar shadow-[0_0_12px_rgba(59,130,246,0.95)]"
                      />
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {showLoggedInSections ? (
          <SidebarGroup>
            <SidebarGroupLabel>{t.buying}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {buyingItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className="min-h-11 rounded-xl px-3 text-sm"
                    >
                      <Link href={item.url} className="relative flex w-full items-center gap-2">
                        {renderMenuItemContent(item)}
                      </Link>
                    </SidebarMenuButton>
                    {item.hasUnreadIndicator ? (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-2 right-2 size-2.5 rounded-full bg-blue-500 ring-2 ring-sidebar shadow-[0_0_12px_rgba(59,130,246,0.95)]"
                      />
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {showLoggedInSections ? (
          <SidebarGroup>
            <SidebarGroupLabel>{t.account}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {accountItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url}
                      tooltip={item.title}
                      className="min-h-11 rounded-xl px-3 text-sm"
                    >
                      <Link href={item.url} className="relative flex w-full items-center gap-2">
                        {renderMenuItemContent(item)}
                      </Link>
                    </SidebarMenuButton>
                    {item.hasUnreadIndicator ? (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-2 right-2 size-2.5 rounded-full bg-blue-500 ring-2 ring-sidebar shadow-[0_0_12px_rgba(59,130,246,0.95)]"
                      />
                    ) : null}
                  </SidebarMenuItem>
                ))}
                <SidebarMenuItem>
                  <SignOutButton />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
