"use client";

import { ChevronDownIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function DashboardCategoryFilter({ value, onValueChange, options }) {
  return (
    <div className="w-full md:w-[240px]">
      <Label htmlFor="dashboard-category-filter" className="sr-only">
        Filter dashboard listings by category
      </Label>
      <div className="relative">
        <select
          id="dashboard-category-filter"
          value={value ?? ""}
          onChange={(event) => onValueChange(event.target.value)}
          className={cn(
            "h-10 w-full appearance-none rounded-xl border border-input bg-white px-3 pr-9 text-sm text-zinc-900 outline-none transition-colors",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
        >
          <option value="">All categories</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
      </div>
    </div>
  );
}
