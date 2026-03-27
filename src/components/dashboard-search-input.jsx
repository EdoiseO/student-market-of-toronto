"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SEARCH_DEBOUNCE_MS = 400;

export function DashboardSearchInput() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = React.useRef(null);
  const queryValue = searchParams.get("q") ?? "";
  const [value, setValue] = React.useState(queryValue);

  React.useEffect(() => {
    setValue(queryValue);
  }, [queryValue]);

  React.useEffect(() => {
    const normalizedValue = value.trim();

    if (normalizedValue === queryValue) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());

      if (normalizedValue) {
        params.set("q", normalizedValue);
      } else {
        params.delete("q");
      }

      params.delete("page");

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pathname, queryValue, router, searchParams, value]);

  function clearQuery() {
    setValue("");
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  return (
    <div className="relative w-full md:max-w-sm">
      <Label htmlFor="dashboard-search" className="sr-only">
        Search dashboard listings
      </Label>
      <Input
        ref={inputRef}
        id="dashboard-search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value.length > 0) {
            event.preventDefault();
            clearQuery();
          }
        }}
        placeholder="Search your listings..."
        className="h-10 rounded-xl bg-white pl-9 pr-10 text-sm"
      />
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={clearQuery}
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Clear dashboard search"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
