"use client";

import { SearchIcon, XIcon } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DashboardSearchInput({ value, onValueChange }) {
  const { t } = useLanguage();

  return (
    <div className="relative w-full md:w-[220px] lg:w-[240px]">
      <Label htmlFor="dashboard-search" className="sr-only">
        {t.dashboardSearchLabel}
      </Label>
      <Input
        id="dashboard-search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value.length > 0) {
            event.preventDefault();
            onValueChange("");
          }
        }}
        placeholder={t.searchYourListingsPlaceholder}
        className="h-9 rounded-lg bg-white pl-8 pr-9 text-sm"
      />
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onValueChange("")}
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label={t.clearDashboardSearch}
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
