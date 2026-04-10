"use client";

/* eslint-disable @next/next/no-img-element */

import * as React from "react";
import Link from "next/link";
import { CircleCheckIcon, Loader2Icon } from "lucide-react";

import { DashboardCategoryFilter } from "@/components/dashboard-category-filter";
import { DashboardSearchInput } from "@/components/dashboard-search-input";
import { useLanguage } from "@/context/LanguageContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardListingActions } from "@/components/dashboard-listing-actions";
import { CATEGORY_OPTIONS, getTranslatedCategoryValue } from "@/lib/categories";
import {
  LISTING_APPROVAL_STATUS_VALUES,
  isPendingListingApproval,
  isListingResubmittedAfterEdit,
} from "@/lib/listing-approval";

const rowsPerPageOptions = [7, 10, 15];
const readOnlyTabs = new Set(["favourite"]);

const statusBadgeClasses = {
  active: "border-zinc-200 bg-white text-zinc-700 dark:border-border dark:bg-background dark:text-foreground",
  inactive:
    "border-zinc-200 bg-white text-zinc-700 dark:border-border dark:bg-background dark:text-foreground",
  [LISTING_APPROVAL_STATUS_VALUES.rejected]:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
  draft: "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-border dark:bg-muted dark:text-foreground",
  sold: "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-border dark:bg-muted dark:text-foreground",
  favourite:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
};

function getDashboardStatusBadgeClass(item) {
  if (isPendingListingApproval(item)) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
  }

  return statusBadgeClasses[item.dashboardStatus];
}

function DashboardStatusBadge({ item, label }) {
  const badgeClassName = getDashboardStatusBadgeClass(item);

  if (isPendingListingApproval(item)) {
    return (
      <Badge variant="outline" className={badgeClassName}>
        <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
        {label}
      </Badge>
    );
  }

  if (item.dashboardStatus === "active") {
    return (
      <Badge variant="outline" className={badgeClassName}>
        <CircleCheckIcon className="mr-1.5 size-3.5 text-emerald-600 dark:text-emerald-400" />
        {label}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={badgeClassName}>
      {label}
    </Badge>
  );
}

function buildDashboardHref(tab) {
  return tab === "all" ? "/dashboard" : `/dashboard?tab=${tab}`;
}

function DashboardStatusNote({ item, t, language }) {
  if (isPendingListingApproval(item)) {
    return (
      <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-muted-foreground">
        {isListingResubmittedAfterEdit(item)
          ? t.listingResubmittedAfterEditDescription
          : t.listingPendingReviewDescription}
        {item.submittedForReviewAt ? (
          <>
            {" "}
            {t.listingPendingReviewSubmittedPrefix} {new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
              month: "short",
              day: "numeric",
            }).format(new Date(item.submittedForReviewAt))}.
          </>
        ) : null}
        {item.moderationFeedback ? (
          <>
            {" "}
            {t.listingPreviousFeedbackPrefix} {item.moderationFeedback}
          </>
        ) : null}
      </p>
    );
  }

  if (item.dashboardStatus === LISTING_APPROVAL_STATUS_VALUES.rejected) {
    return (
      <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-muted-foreground">
        {item.moderationFeedback || t.listingRejectedDescription}
      </p>
    );
  }

  return null;
}

export function DashboardTableClient({ currentTab, ownedItems, favouriteItems, favouriteCount = 0 }) {
  const { t, language } = useLanguage();
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

  const dashboardTabs = React.useMemo(
    () => [
      { key: "all", label: t.all },
      { key: "active", label: t.active },
      { key: "inactive", label: t.inactive },
      { key: "sold", label: t.sold },
      { key: LISTING_APPROVAL_STATUS_VALUES.rejected, label: t.rejected },
      { key: "draft", label: t.draft },
      { key: "favourite", label: t.favourite },
    ],
    [t]
  );

  const statusLabels = React.useMemo(
    () => ({
      active: t.live,
      inactive: t.inactive,
      [LISTING_APPROVAL_STATUS_VALUES.rejected]: t.rejected,
      draft: t.draft,
      sold: t.sold,
      favourite: t.favourite,
    }),
    [t]
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
    [allItems.length, currentTab, dashboardTabs, favouriteCount, filteredFavouriteItems.length, statusCounts]
  );

  const showManagementActions = !readOnlyTabs.has(currentTab);
  const showMessagesColumn = ![
    "favourite",
    "draft",
    LISTING_APPROVAL_STATUS_VALUES.rejected,
  ].includes(currentTab);

  function getStatusLabel(item) {
    return isPendingListingApproval(item) ? t.pendingReview : statusLabels[item.dashboardStatus];
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
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
                    ? "h-9 rounded-xl px-3.5 dark:bg-white dark:text-zinc-950 dark:hover:bg-white/95"
                    : "h-9 rounded-xl bg-white px-3.5 dark:bg-background"
                }
              >
                <Link href={buildDashboardHref(tab.key)}>
                  <span>{tab.label}</span>
                  <span
                    className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isActive
                        ? "bg-white/20 text-white dark:bg-zinc-900/10 dark:text-zinc-950"
                        : "bg-black/10 text-zinc-700 dark:bg-white/10 dark:text-foreground"
                    }`}
                  >
                    {counts[tab.key]}
                  </span>
                </Link>
              </Button>
            );
          })}
        </div>

        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
          <DashboardCategoryFilter
            value={selectedCategory}
            onValueChange={setSelectedCategory}
            options={CATEGORY_OPTIONS}
          />
          <DashboardSearchInput value={dashboardSearch} onValueChange={setDashboardSearch} />
          {showManagementActions ? (
            <Button asChild size="sm" className="h-9 rounded-lg px-3">
              <Link href="/listings/create">{t.addListing}</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 md:hidden">
        {paginatedItems.length > 0 ? (
          paginatedItems.map((item) => (
            <div
              key={`${item.dashboardStatus}-${item.id}`}
              className="rounded-[1.5rem] border border-zinc-200 bg-white p-4 shadow-sm dark:border-border dark:bg-card"
            >
              <Link href={`/listings/${item.slug}`} className="block rounded-xl transition hover:bg-zinc-50 dark:hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-18 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-muted">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-950 dark:text-foreground">{item.title}</p>
                    <p className="mt-1 truncate text-sm text-zinc-500 dark:text-muted-foreground">{item.meta}</p>
                  </div>
                </div>
              </Link>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-border dark:bg-muted/40">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-muted-foreground">{t.status}</p>
                  <div className="mt-2">
                    <DashboardStatusBadge item={item} label={getStatusLabel(item)} />
                    <DashboardStatusNote item={item} t={t} language={language} />
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-border dark:bg-muted/40">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-muted-foreground">{t.price}</p>
                  <p className="mt-2 font-medium text-zinc-900 dark:text-foreground">{item.price}</p>
                </div>
                {showMessagesColumn ? (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-border dark:bg-muted/40">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-muted-foreground">{t.messages}</p>
                    <p className="mt-2 text-zinc-700 dark:text-foreground">{item.messageCount > 0 ? `${item.messageCount}+` : "0"}</p>
                  </div>
                ) : null}
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-border dark:bg-muted/40">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-muted-foreground">{t.category}</p>
                  <p className="mt-2 line-clamp-2 text-zinc-700 dark:text-foreground">
                    {getTranslatedCategoryValue(item.category, t, language)}
                  </p>
                </div>
              </div>

              {showManagementActions ? (
                <div className="mt-4">
                  <DashboardListingActions
                    id={item.id}
                    slug={item.slug}
                    status={item.dashboardStatus}
                    submittedForReviewAt={item.submittedForReviewAt}
                    moderationReviewedAt={item.moderationReviewedAt}
                  />
                </div>
              ) : null}
            </div>
          ))
        ) : filteredItems.length === 0 ? (
          <div className="rounded-[1.5rem] border border-zinc-200 bg-white px-6 py-10 text-center text-sm text-zinc-500 shadow-sm dark:border-border dark:bg-card dark:text-muted-foreground">
            {hasActiveFilters
              ? t.dashboardNoListingsMatchFilters
              : t.noListingsInSection}
          </div>
        ) : null}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between gap-3 rounded-[1.5rem] border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 shadow-sm dark:border-border dark:bg-card dark:text-muted-foreground">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={safePage === 1 ? "pointer-events-none opacity-50" : ""}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            >
              {t.previousPage}
            </Button>
            <span className="text-center font-medium text-zinc-700 dark:text-foreground">
              {t.pageLabel} {safePage} {t.ofLabel} {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={safePage === totalPages ? "pointer-events-none opacity-50" : ""}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            >
              {t.nextPage}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="hidden overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white dark:border-border dark:bg-card md:block">
        <div className="overflow-x-hidden">
          <table className="w-full table-fixed text-left">
            <thead className="bg-zinc-50 dark:bg-muted/40">
              <tr className="border-b border-zinc-200 text-sm text-zinc-500 dark:border-border dark:text-muted-foreground">
                <th className="w-[32%] px-5 py-3.5 font-medium">{t.listing}</th>
                <th className="w-[10%] px-5 py-3.5 text-center font-medium">{t.status}</th>
                <th className="w-[10%] px-5 py-3.5 text-center font-medium">{t.price}</th>
                {showMessagesColumn ? (
                  <th className="w-[9%] px-5 py-3.5 text-center font-medium">{t.messages}</th>
                ) : null}
                <th className="w-[13%] px-5 py-3.5 text-center font-medium">{t.category}</th>
                {showManagementActions ? (
                  <th className="w-[26%] px-5 py-3.5 text-right font-medium">{t.actions}</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((item) => (
                <tr key={`${item.dashboardStatus}-${item.id}`} className="border-b border-zinc-200 last:border-b-0 dark:border-border">
                  <td className="px-5 py-4 align-top">
                    <Link href={`/listings/${item.slug}`} className="block rounded-xl transition hover:bg-zinc-50 dark:hover:bg-muted/40">
                      <div className="flex items-center gap-4 py-1">
                        <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-muted">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-zinc-950 dark:text-foreground">{item.title}</p>
                          <p className="mt-1 truncate text-sm text-zinc-500 dark:text-muted-foreground">{item.meta}</p>
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-4 align-middle whitespace-nowrap text-center">
                    <div className="mx-auto flex max-w-[280px] flex-col items-center text-center">
                      <DashboardStatusBadge item={item} label={getStatusLabel(item)} />
                      <DashboardStatusNote item={item} t={t} language={language} />
                    </div>
                  </td>
                  <td className="px-5 py-4 align-middle text-center font-medium whitespace-nowrap text-zinc-900 dark:text-foreground">{item.price}</td>
                  {showMessagesColumn ? (
                    <td className="px-5 py-4 align-middle text-center whitespace-nowrap text-zinc-700 dark:text-foreground">{item.messageCount > 0 ? `${item.messageCount}+` : "0"}</td>
                  ) : null}
                  <td className="px-5 py-4 align-middle text-center text-zinc-700 dark:text-foreground">
                    <span className="block line-clamp-2 text-center">{getTranslatedCategoryValue(item.category, t, language)}</span>
                  </td>
                  {showManagementActions ? (
                    <td className="px-5 py-4 align-top text-right">
                      <DashboardListingActions
                        id={item.id}
                        slug={item.slug}
                        status={item.dashboardStatus}
                        submittedForReviewAt={item.submittedForReviewAt}
                        moderationReviewedAt={item.moderationReviewedAt}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredItems.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-zinc-500 dark:text-muted-foreground">
            {hasActiveFilters
              ? t.dashboardNoListingsMatchFilters
              : t.noListingsInSection}
          </div>
        ) : null}

        {filteredItems.length > 7 ? (
          <div className="flex flex-col gap-4 border-t border-zinc-200 px-5 py-4 text-sm text-zinc-500 dark:border-border dark:text-muted-foreground md:flex-row md:items-center md:justify-between">
            <p>0 {t.ofLabel} {filteredItems.length} {t.selectedRowsLabel}.</p>
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-700 dark:text-foreground">{t.rowsPerPage}</span>
                <div className="flex items-center gap-2">
                  {rowsPerPageOptions.map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={rowsPerPage === option ? "outline" : "ghost"}
                      size="sm"
                      className={rowsPerPage === option ? "h-9 rounded-xl bg-white px-3 dark:bg-background" : "h-9 rounded-xl px-3"}
                      onClick={() => setRowsPerPage(option)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium text-zinc-700 dark:text-foreground">{t.pageLabel} {safePage} {t.ofLabel} {totalPages}</span>
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
