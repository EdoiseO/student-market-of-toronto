"use client";

import { SearchIcon, XIcon } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DashboardSearchInput({
  value,
  onValueChange,
  id = "dashboard-search",
}) {
  const { t, language } = useLanguage();
  const widthClassName = language === "fr" ? "md:w-[156px] lg:w-[172px]" : "md:w-[180px] lg:w-[200px]";

  return (
    <div className={`relative w-full ${widthClassName}`}>
      <Label htmlFor={id} className="sr-only">
        {t.dashboardSearchLabel}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value.length > 0) {
            event.preventDefault();
            onValueChange("");
          }
        }}
        placeholder={t.searchYourListingsPlaceholder}
        className="h-11 rounded-xl bg-white pl-9 pr-12 text-base dark:bg-input/30"
      />
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500 dark:text-muted-foreground" />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onValueChange("")}
          className="absolute right-1.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
          aria-label={t.clearDashboardSearch}
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
