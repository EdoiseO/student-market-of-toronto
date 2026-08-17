"use client"

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import LanguageSwitcher from "@/components/language-switcher";
import { NotificationsButton } from "@/components/notifications-button";
import { SearchForm } from "@/components/search-form"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useSidebar } from "@/components/ui/sidebar"
import { PanelLeftIcon, SearchIcon, StoreIcon } from "lucide-react"

import { useLanguage } from "@/context/LanguageContext";
import { translations } from "@/lib/translations";

function useMediaQuery(query) {
  return React.useSyncExternalStore(
    React.useCallback((onStoreChange) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", onStoreChange);
      return () => mediaQuery.removeEventListener("change", onStoreChange);
    }, [query]),
    React.useCallback(() => window.matchMedia(query).matches, [query]),
    () => false,
  );
}

export function SiteHeader({ user }) {
  const { toggleSidebar } = useSidebar()
  const pathname = usePathname() ?? "";
  const { language } = useLanguage();
  const t = translations[language];
  const isMobileViewport = useMediaQuery("(max-width: 767px)");
  const isWideViewport = useMediaQuery("(min-width: 1280px)");

  const pageTitle =
    pathname === "/"
      ? t.browseListings
    : pathname.startsWith("/search")
        ? t.searchAndFilter
      : pathname.startsWith("/admin")
        ? t.adminDashboard
      : pathname.startsWith("/messages")
        ? t.messages
      : pathname.startsWith("/dashboard/standing")
        ? t.accountStanding
      : pathname.startsWith("/dashboard")
        ? t.dashboard
        : pathname.endsWith("/edit")
          ? t.editListing
          : pathname.startsWith("/listings/create")
            ? t.createListing
            : t.studentMarket;

  return (
    <header
      className="sticky top-0 z-50 flex w-full items-center border-b bg-background">
      <div className="flex h-16 w-full items-center gap-2 px-4 md:hidden">
        <Link
          href="/"
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <StoreIcon className="size-5" />
          </span>
          <span className="truncate text-base font-bold tracking-tight">{t.studentMarket}</span>
        </Link>

        <Link
          href="/search"
          aria-label={t.searchListingsLabel}
          className="flex size-[44px] shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SearchIcon className="size-5" />
        </Link>
        <div className="shrink-0 [&_button]:min-h-[44px] [&_button]:min-w-[44px]">
          <NotificationsButton user={user} enabled={isMobileViewport} />
        </div>
      </div>

      <div className="hidden w-full grid-cols-1 gap-3 px-4 py-3 md:grid md:h-(--header-height) md:grid-cols-[minmax(192px,1fr)_minmax(0,416px)] md:items-center md:px-5 md:py-0 xl:grid-cols-[minmax(224px,1fr)_minmax(336px,784px)_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            className="h-10 w-10 rounded-xl"
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
          >
            <PanelLeftIcon />
          </Button>
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-5 data-vertical:self-auto" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-foreground" suppressHydrationWarning>
              {pageTitle}
            </p>
            <p className="hidden text-sm text-muted-foreground xl:block">
              {t.browseListingsSubtitle}
            </p>
          </div>
          <div className="ml-auto shrink-0 xl:hidden">
            <div className="flex items-center gap-2">
              <NotificationsButton
                user={user}
                enabled={!isMobileViewport && !isWideViewport}
              />
              <ThemeToggle />
            </div>
          </div>
        </div>
        <div className="flex min-w-0 justify-center">
          <SearchForm className="w-full max-w-2xl xl:max-w-4xl" />
        </div>
        <div className="hidden items-center justify-end gap-2 xl:flex">
          <NotificationsButton user={user} enabled={isWideViewport} />
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
