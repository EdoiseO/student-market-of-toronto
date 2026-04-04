"use client";

import { useLanguage } from "@/context/LanguageContext";
import { getTranslatedCategoryValue } from "@/lib/categories";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export function DashboardCategoryFilter({ value, onValueChange, options }) {
  const { t, language } = useLanguage();

  return (
    <div className="w-full md:w-[160px] lg:w-[170px]">
      <Label htmlFor="dashboard-category-filter" className="sr-only">
        {t.filterDashboardByCategory}
      </Label>
      <NativeSelect
        id="dashboard-category-filter"
        value={value ?? ""}
        onChange={(event) => onValueChange(event.target.value)}
        className="w-full"
        size="default"
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
