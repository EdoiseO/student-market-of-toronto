"use client"

import { Label } from "@/components/ui/label"
import { SidebarInput } from "@/components/ui/sidebar"
import { SearchIcon } from "lucide-react"

export function SearchForm({
  ...props
}) {
  return (
    <div {...props} aria-disabled="true">
      <div className="relative">
        <Label htmlFor="search-coming-soon" className="sr-only">
          Search coming soon
        </Label>
        <SidebarInput
          id="search-coming-soon"
          placeholder="Search coming soon"
          disabled
          className="h-10 rounded-xl pl-9 pr-28 text-sm disabled:cursor-default disabled:opacity-100"
        />
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-50 select-none" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
          Soon
        </span>
      </div>
    </div>
  );
}
