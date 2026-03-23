"use client"

import { usePathname } from "next/navigation";

import { SearchForm } from "@/components/search-form"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useSidebar } from "@/components/ui/sidebar"
import { PanelLeftIcon } from "lucide-react"

export function SiteHeader() {
  const { toggleSidebar } = useSidebar()
  const pathname = usePathname();

  const pageTitle =
    pathname === "/"
      ? "Browse Listings"
      : pathname.startsWith("/dashboard")
        ? "Dashboard"
        : pathname.endsWith("/edit")
          ? "Edit Listing"
        : pathname.startsWith("/listings/create")
          ? "Create Listing"
          : "Student Market";

  return (
    <header
      className="sticky top-0 z-50 flex w-full items-center border-b bg-background">
      <div className="grid h-(--header-height) w-full grid-cols-[minmax(0,1fr)_minmax(420px,980px)_minmax(0,1fr)] items-center gap-4 px-5">
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
          <div className="hidden sm:block">
            <p className="text-base font-semibold text-foreground">{pageTitle}</p>
            <p className="text-sm text-muted-foreground">
              Buy, sell, and discover listings from Toronto students.
            </p>
          </div>
        </div>
        <div className="flex justify-center">
          <SearchForm className="w-full max-w-4xl" />
        </div>
        <div />
      </div>
    </header>
  );
}
