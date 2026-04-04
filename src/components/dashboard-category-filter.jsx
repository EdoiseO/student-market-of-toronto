"use client";

import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export function DashboardCategoryFilter({ value, onValueChange, options }) {
  return (
    <div className="w-full md:w-[160px] lg:w-[170px]">
      <Label htmlFor="dashboard-category-filter" className="sr-only">
        Filter dashboard listings by category
      </Label>
      <NativeSelect
        id="dashboard-category-filter"
        value={value ?? ""}
        onChange={(event) => onValueChange(event.target.value)}
        className="w-full"
        size="default"
      >
        <NativeSelectOption value="">All categories</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
