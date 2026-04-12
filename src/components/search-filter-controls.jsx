"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function SearchCombobox({ label, placeholder, value, onValueChange, options, active = false }) {
  const { t } = useLanguage();

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Combobox value={value} onValueChange={onValueChange}>
        <ComboboxInput
          placeholder={placeholder}
          className={cn(
            "w-full rounded-lg border border-input transition-colors",
            active && "border-border bg-muted text-foreground dark:bg-muted/40"
          )}
        />
        <ComboboxContent>
          <ComboboxEmpty>{t.noOptionFound}</ComboboxEmpty>
          <ComboboxList>
            {options.map((option) => (
              <ComboboxItem key={option.value || "all"} value={option.value}>
                {option.label}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

export function SearchFilterControls({
  initialFilters,
  conditionOptions,
  tagOptions,
  sortOptions,
  basePath = "/search",
  compact = false,
  fieldsClassName,
  className,
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [minPrice, setMinPrice] = React.useState(initialFilters.min ?? "");
  const [maxPrice, setMaxPrice] = React.useState(initialFilters.max ?? "");
  const [condition, setCondition] = React.useState(initialFilters.condition ?? "");
  const [tag, setTag] = React.useState(initialFilters.tag ?? "");
  const [sortBy, setSortBy] = React.useState(initialFilters.sort ?? "new-old");

  React.useEffect(() => {
    setMinPrice(initialFilters.min ?? "");
    setMaxPrice(initialFilters.max ?? "");
    setCondition(initialFilters.condition ?? "");
    setTag(initialFilters.tag ?? "");
    setSortBy(initialFilters.sort ?? "new-old");
  }, [
    initialFilters.min,
    initialFilters.max,
    initialFilters.condition,
    initialFilters.tag,
    initialFilters.sort,
  ]);

  function handleApply(event) {
    event.preventDefault();

    const params = new URLSearchParams();

    if (initialFilters.q) params.set("q", initialFilters.q);
    if (minPrice) params.set("min", minPrice);
    if (maxPrice) params.set("max", maxPrice);
    if (condition) params.set("condition", condition);
    if (tag) params.set("tag", tag);
    if (sortBy && sortBy !== "new-old") params.set("sort", sortBy);

    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  function handleClear() {
    const params = new URLSearchParams();

    if (initialFilters.q) params.set("q", initialFilters.q);

    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
    setMinPrice("");
    setMaxPrice("");
    setCondition("");
    setTag("");
    setSortBy("new-old");
  }

  return (
    <form onSubmit={handleApply} className={cn("flex flex-col gap-3", className)}>
      <div className={cn("grid gap-3", compact ? "sm:grid-cols-2 xl:grid-cols-4" : "", fieldsClassName) }>
        <div className="space-y-2">
          <Label>{t.priceLabel}</Label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              id={compact ? "mobile-min" : "desktop-min"}
              value={minPrice}
              onChange={(event) => setMinPrice(event.target.value)}
              placeholder={t.minLabel}
              inputMode="decimal"
            />
            <Input
              id={compact ? "mobile-max" : "desktop-max"}
              value={maxPrice}
              onChange={(event) => setMaxPrice(event.target.value)}
              placeholder={t.maxLabel}
              inputMode="decimal"
            />
          </div>
        </div>
        <SearchCombobox
          label={t.conditionLabel}
          placeholder={t.allConditions}
          value={condition}
          onValueChange={setCondition}
          options={conditionOptions}
          active={Boolean(condition)}
        />
        <SearchCombobox
          label={t.tagsLabel}
          placeholder={t.allTags}
          value={tag}
          onValueChange={setTag}
          options={tagOptions}
          active={Boolean(tag)}
        />
        <SearchCombobox
          label={t.sortByLabel}
          placeholder={t.sortDateNewest}
          value={sortBy}
          onValueChange={setSortBy}
          options={sortOptions}
          active={sortBy !== "new-old"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">{t.applyFilters}</Button>
        <Button type="button" variant="outline" onClick={handleClear}>
          {t.clearText}
        </Button>
      </div>
    </form>
  );
}
