"use client"

import { usePathname } from "next/navigation";

import LanguageSwitcher from "@/components/language-switcher";
import { SearchForm } from "@/components/search-form"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useSidebar } from "@/components/ui/sidebar"
import { PanelLeftIcon } from "lucide-react"

import { useLanguage } from "@/context/LanguageContext";
import { translations } from "@/lib/translations";

export function SiteHeader() {
  const { toggleSidebar } = useSidebar()
  const pathname = usePathname();
  const { language } = useLanguage();
  const t = translations[language];

  const pageTitle =
    pathname === "/"
      ? t.browseListings
      : pathname.startsWith("/search")
        ? "Search & Filter"
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
      <div className="grid w-full grid-cols-1 gap-3 px-4 py-3 md:h-(--header-height) md:grid-cols-[minmax(240px,1fr)_minmax(0,520px)] md:items-center md:px-5 md:py-0 xl:grid-cols-[minmax(280px,1fr)_minmax(420px,980px)_minmax(0,1fr)]">
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
            <p className="truncate text-base font-semibold text-foreground">{pageTitle}</p>
            <p className="hidden text-sm text-muted-foreground xl:block">
              {t.browseListingsSubtitle}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 justify-center">
          <SearchForm className="w-full max-w-2xl xl:max-w-4xl" />
        </div>
        <div className="hidden items-center justify-end xl:flex">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
