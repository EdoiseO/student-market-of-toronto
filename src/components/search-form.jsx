"use client"

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";

import { Label } from "@/components/ui/label"
import { SidebarInput } from "@/components/ui/sidebar"
import { SearchIcon, XIcon } from "lucide-react"

export function SearchForm({
  ...props
}) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchValue = pathname === "/search" ? (searchParams.get("q") ?? "") : "";
  const inputRef = React.useRef(null);
  const [value, setValue] = React.useState(searchValue);

  React.useEffect(() => {
    setValue(searchValue);
  }, [searchValue]);

  function clearSearchQuery() {
    setValue("");

    if (pathname === "/search") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("q");
      const query = params.toString();

      router.push(query ? `/search?${query}` : "/search");
    }

    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  function handleSubmit(event) {
    event.preventDefault();

    const query = value.trim();
    const params = pathname.startsWith("/search")
      ? new URLSearchParams(searchParams.toString())
      : new URLSearchParams();

    if (query) {
      params.set("q", query);
    } else {
      params.delete("q");
    }

    params.delete("page");

    router.push(params.toString() ? `/search?${params.toString()}` : "/search");
  }

  return (
    <form onSubmit={handleSubmit} {...props}>
      <div className="relative">
        <Label htmlFor="search" className="sr-only">
          {t.searchListingsLabel}
        </Label>
        <SidebarInput
          ref={inputRef}
          id="search"
          name="q"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && value.length > 0) {
              event.preventDefault();
              clearSearchQuery();
            }
          }}
          placeholder={t.searchListingsPlaceholderGlobal}
          className="h-10 rounded-xl pl-9 pr-10 text-sm"
        />
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-50 select-none" />
        {value.length > 0 ? (
          <button
            type="button"
            onClick={clearSearchQuery}
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
            aria-label={t.clearSearch}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
    </form>
  );
}
