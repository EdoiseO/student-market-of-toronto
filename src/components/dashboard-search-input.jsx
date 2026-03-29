"use client";

import { SearchIcon, XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DashboardSearchInput({ value, onValueChange }) {
  return (
    <div className="relative w-full md:max-w-sm">
      <Label htmlFor="dashboard-search" className="sr-only">
        Search dashboard listings
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
        placeholder="Search your listings..."
        className="h-10 rounded-xl bg-white pl-9 pr-10 text-sm"
      />
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onValueChange("")}
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Clear dashboard search"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
