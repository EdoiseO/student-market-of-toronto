"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { SearchFilterControls } from "@/components/search-filter-controls";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { conditionOptions, sortOptions, tagOptions } from "@/lib/search-listings";

export function SearchSidebarFilters() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pathname !== "/search") {
    return null;
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Filters</SidebarGroupLabel>
      <SidebarGroupContent>
        <SearchFilterControls
          basePath="/search"
          initialFilters={{
            q: searchParams.get("q") ?? "",
            min: searchParams.get("min") ?? "",
            max: searchParams.get("max") ?? "",
            condition: searchParams.get("condition") ?? "",
            tag: searchParams.get("tag") ?? "",
            sort: searchParams.get("sort") ?? "new-old",
          }}
          conditionOptions={conditionOptions}
          tagOptions={tagOptions}
          sortOptions={sortOptions}
          className="rounded-2xl border border-zinc-200 bg-white p-3"
          fieldsClassName="grid-cols-1"
        />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
