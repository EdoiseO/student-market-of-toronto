"use client";

/* eslint-disable @next/next/no-img-element */

import * as React from "react";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { DashboardCategoryFilter } from "@/components/dashboard-category-filter";
import { DashboardSearchInput } from "@/components/dashboard-search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardListingActions } from "@/components/dashboard-listing-actions";
import { CATEGORY_OPTIONS } from "@/lib/categories";

const dashboardTabs = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "sold", label: "Sold" },
  { key: "draft", label: "Draft" },
  { key: "favourite", label: "Favourite" },
];

const rowsPerPageOptions = [7, 10, 15];
const readOnlyTabs = new Set(["favourite"]);
const editableStatuses = new Set(["active", "inactive", "draft", "sold"]);

const statusBadgeClasses = {
  active: "border-zinc-200 bg-white text-zinc-700",
  inactive: "border-zinc-200 bg-white text-zinc-700",
  draft: "border-zinc-200 bg-zinc-100 text-zinc-700",
  sold: "border-zinc-200 bg-zinc-100 text-zinc-700",
  favourite: "border-rose-200 bg-rose-50 text-rose-700",
};

const statusLabels = {
  active: "Live",
  inactive: "Inactive",
  draft: "Draft",
  sold: "Sold",
  favourite: "Favourite",
};

function DashboardStatusBadge({ status }) {
  if (status === "active") {
    return (
      <Badge variant="outline" className={statusBadgeClasses[status]}>
        <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CheckIcon className="size-3" />
        </span>
        {statusLabels[status]}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={statusBadgeClasses[status]}>
      {statusLabels[status]}
    </Badge>
  );
}

function buildDashboardHref(tab) {
  return tab === "all" ? "/dashboard" : `/dashboard?tab=${tab}`;
}

export function DashboardTableClient({ currentTab, ownedItems, favouriteItems, favouriteCount = 0 }) {
  const [dashboardSearch, setDashboardSearch] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("");
  const [rowsPerPage, setRowsPerPage] = React.useState(7);
  const [currentPage, setCurrentPage] = React.useState(1);

  const normalizedDashboardSearch = dashboardSearch.trim().toLowerCase();
  const hasActiveFilters = Boolean(normalizedDashboardSearch || selectedCategory);

  const matchesDashboardQuery = React.useCallback(
    (item) => {
      if (!normalizedDashboardSearch) {
        return true;
      }

      return [item.title, item.meta, item.category]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedDashboardSearch));
    },
    [normalizedDashboardSearch]
  );

  const matchesSelectedCategory = React.useCallback(
    (item) => {
      if (!selectedCategory) {
        return true;
      }

      return item.category === selectedCategory;
    },
    [selectedCategory]
  );

  const filteredOwnedItems = React.useMemo(
    () => ownedItems.filter((item) => matchesDashboardQuery(item) && matchesSelectedCategory(item)),
    [ownedItems, matchesDashboardQuery, matchesSelectedCategory]
  );

  const filteredFavouriteItems = React.useMemo(
    () => favouriteItems.filter((item) => matchesDashboardQuery(item) && matchesSelectedCategory(item)),
    [favouriteItems, matchesDashboardQuery, matchesSelectedCategory]
  );

  const allItems = filteredOwnedItems;

  const filteredItems = React.useMemo(() => {
    if (currentTab === "all") {
      return allItems;
    }

    if (currentTab === "favourite") {
      return filteredFavouriteItems;
    }

    return filteredOwnedItems.filter((item) => item.dashboardStatus === currentTab);
  }, [allItems, currentTab, filteredFavouriteItems, filteredOwnedItems]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [dashboardSearch, currentTab, rowsPerPage, selectedCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedItems = filteredItems.slice(
    (safePage - 1) * rowsPerPage,
    safePage * rowsPerPage,
  );

  const statusCounts = React.useMemo(
    () =>
      filteredOwnedItems.reduce((acc, item) => {
        acc[item.dashboardStatus] = (acc[item.dashboardStatus] ?? 0) + 1;
        return acc;
      }, {}),
    [filteredOwnedItems]
  );

  const counts = React.useMemo(
    () =>
      dashboardTabs.reduce((acc, tab) => {
        if (tab.key === "all") {
          acc[tab.key] = allItems.length;
        } else if (tab.key === "favourite") {
          acc[tab.key] = currentTab === "favourite"
            ? filteredFavouriteItems.length
            : favouriteCount;
        } else {
          acc[tab.key] = statusCounts[tab.key] ?? 0;
        }
        return acc;
      }, {}),
    [allItems.length, currentTab, favouriteCount, filteredFavouriteItems.length, statusCounts]
  );

  const showManagementActions = !readOnlyTabs.has(currentTab);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2.5">
          {dashboardTabs.map((tab) => {
            const isActive = currentTab === tab.key;
            return (
              <Button
                key={tab.key}
                asChild
                variant={isActive ? "default" : "outline"}
                size="sm"
                className={
                  isActive
                    ? "h-10 rounded-xl px-4"
                    : "h-10 rounded-xl bg-white px-4"
                }
              >
                <Link href={buildDashboardHref(tab.key)}>
                  <span>{tab.label}</span>
                  <span
                    className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-black/10 text-zinc-700"
                    }`}
                  >
                    {counts[tab.key]}
                  </span>
                </Link>
              </Button>
            );
          })}
        </div>

        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
          <DashboardCategoryFilter
            value={selectedCategory}
            onValueChange={setSelectedCategory}
            options={CATEGORY_OPTIONS}
          />
          <DashboardSearchInput value={dashboardSearch} onValueChange={setDashboardSearch} />
          {showManagementActions ? (
            <Button asChild className="h-10 rounded-xl px-4">
              <Link href="/listings/create">Add Listing</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-zinc-50">
              <tr className="border-b border-zinc-200 text-sm text-zinc-500">
                <th className="px-6 py-4 font-medium">Listing</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Price</th>
                <th className="px-6 py-4 font-medium">Messages</th>
                <th className="px-6 py-4 font-medium">Category</th>
                {showManagementActions ? (
                  <th className="px-6 py-4 text-right font-medium">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((item) => (
                <tr key={`${item.dashboardStatus}-${item.id}`} className="border-b border-zinc-200 last:border-b-0">
                  <td className="px-6 py-5">
                    <Link href={`/listings/${item.slug}`} className="block rounded-xl transition hover:bg-zinc-50">
                      <div className="flex items-center gap-4 py-1">
                        <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full bg-zinc-100" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-zinc-950">{item.title}</p>
                          <p className="mt-1 truncate text-sm text-zinc-500">{item.meta}</p>
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-6 py-5">
                    <DashboardStatusBadge status={item.dashboardStatus} />
                  </td>
                  <td className="px-6 py-5 font-medium text-zinc-900">{item.price}</td>
                  <td className="px-6 py-5 text-zinc-700">{item.messageCount > 0 ? `${item.messageCount}+` : "0"}</td>
                  <td className="px-6 py-5 text-zinc-700">{item.category}</td>
                  {showManagementActions ? (
                    <td className="px-6 py-5 text-right">
                      {editableStatuses.has(item.dashboardStatus) ? (
                        <DashboardListingActions id={item.id} slug={item.slug} status={item.dashboardStatus} />
                      ) : (
                        <span className="text-sm text-zinc-400">-</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredItems.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-zinc-500">
            {hasActiveFilters
              ? "No listings match your current search and category filter."
              : "No listings found for this section yet."}
          </div>
        ) : null}

        {filteredItems.length > 7 ? (
          <div className="flex flex-col gap-4 border-t border-zinc-200 px-6 py-4 text-sm text-zinc-500 md:flex-row md:items-center md:justify-between">
            <p>0 of {filteredItems.length} row(s) selected.</p>
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-700">Rows per page</span>
                <div className="flex items-center gap-2">
                  {rowsPerPageOptions.map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={rowsPerPage === option ? "outline" : "ghost"}
                      size="sm"
                      className={rowsPerPage === option ? "h-9 rounded-xl bg-white px-3" : "h-9 rounded-xl px-3"}
                      onClick={() => setRowsPerPage(option)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium text-zinc-700">Page {safePage} of {totalPages}</span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon-sm" className={safePage === 1 ? "pointer-events-none opacity-50" : ""} onClick={() => setCurrentPage(1)}>
                    <span aria-hidden="true">«</span>
                  </Button>
                  <Button type="button" variant="outline" size="icon-sm" className={safePage === 1 ? "pointer-events-none opacity-50" : ""} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>
                    <span aria-hidden="true">‹</span>
                  </Button>
                  <Button type="button" variant="outline" size="icon-sm" className={safePage === totalPages ? "pointer-events-none opacity-50" : ""} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>
                    <span aria-hidden="true">›</span>
                  </Button>
                  <Button type="button" variant="outline" size="icon-sm" className={safePage === totalPages ? "pointer-events-none opacity-50" : ""} onClick={() => setCurrentPage(totalPages)}>
                    <span aria-hidden="true">»</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
