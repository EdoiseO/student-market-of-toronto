"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { SearchFilterControls } from "@/components/search-filter-controls";
import { useLanguage } from "@/context/LanguageContext";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import {
  conditionOptions,
  getTranslatedConditionLabel,
  getTranslatedSortLabel,
  getTranslatedTagLabel,
  sortOptions,
  tagOptions,
} from "@/lib/search-listings";

export function SearchSidebarFilters() {
  const { t } = useLanguage();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pathname !== "/search") {
    return null;
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t.filters}</SidebarGroupLabel>
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
          conditionOptions={conditionOptions.map((option) => ({
            ...option,
            label: option.value ? getTranslatedConditionLabel(option.value, t) : t.allConditions,
          }))}
          tagOptions={tagOptions.map((option) => ({
            ...option,
            label: option.value ? getTranslatedTagLabel(option.value, t) : t.allTags,
          }))}
          sortOptions={sortOptions.map((option) => ({
            ...option,
            label: getTranslatedSortLabel(option.value, t),
          }))}
          className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-border dark:bg-card"
          fieldsClassName="grid-cols-1"
        />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
