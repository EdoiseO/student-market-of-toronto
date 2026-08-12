"use client";

import { useLanguage } from "@/context/LanguageContext";
import { getTranslatedCategoryValue } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export function DashboardCategoryFilter({
  value,
  onValueChange,
  options,
  id = "dashboard-category-filter",
  className = "",
  label = null,
  showLabel = false,
}) {
  const { t, language } = useLanguage();

  return (
    <div className={cn("w-full md:w-[160px] lg:w-[170px]", className)}>
      <Label htmlFor={id} className={showLabel ? "mb-1.5 block text-xs" : "sr-only"}>
        {label ?? t.filterDashboardByCategory}
      </Label>
      <NativeSelect
        id={id}
        value={value ?? ""}
        onChange={(event) => onValueChange(event.target.value)}
        className="w-full"
        size="sm"
      >
        <NativeSelectOption value="">{t.allCategories}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {getTranslatedCategoryValue(option, t, language)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
