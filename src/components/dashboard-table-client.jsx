"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { DashboardCategoryFilter } from "@/components/dashboard-category-filter";
import { DashboardSearchInput } from "@/components/dashboard-search-input";
import { useLanguage } from "@/context/LanguageContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DashboardListingActions } from "@/components/dashboard-listing-actions";
import { CATEGORY_OPTIONS, getTranslatedCategoryValue } from "@/lib/categories";
import { REMOTE_IMAGE_BLUR_DATA_URL } from "@/lib/image-config";
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
    return "border-zinc-200 bg-white text-zinc-700 dark:border-border dark:bg-background dark:text-foreground";
  }

  return statusBadgeClasses[item.dashboardStatus];
}

function formatPendingReviewDate(value, language) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function getPendingReviewTooltipText(item, t, language) {
  const submittedDate = formatPendingReviewDate(item.submittedForReviewAt, language);
  let text = isListingResubmittedAfterEdit(item)
    ? t.listingResubmittedAfterEditDescription
    : t.listingPendingReviewDescription;

  if (submittedDate) {
    text = `${text} ${t.listingPendingReviewSubmittedPrefix} ${submittedDate}.`;
  }

  if (item.moderationFeedback) {
    text = `${text} ${t.listingPreviousFeedbackPrefix} ${item.moderationFeedback}`;
  }

  return text;
}

function getRejectedListingHelpText(item, t) {
  return item.moderationFeedback || t.listingRejectedDescription;
}

function PendingReviewHelpButton({ item, t, language }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t.viewContext}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-100 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" sideOffset={8} className="w-[min(18rem,calc(100vw-2rem))]">
        <PopoverDescription className="text-sm leading-5 text-foreground">
          {getPendingReviewTooltipText(item, t, language)}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}

function RejectedListingReasonButton({ item, t }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={t.viewContext}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.listingRejectedTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {getRejectedListingHelpText(item, t)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.close ?? t.cancel}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DashboardStatusBadge({ item, label, t, language }) {
  const badgeClassName = getDashboardStatusBadgeClass(item);

  if (isPendingListingApproval(item)) {
    return (
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Badge variant="outline" className={badgeClassName}>
                <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                {label}
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8} className="hidden max-w-[260px] text-center leading-5 md:inline-flex">
            {getPendingReviewTooltipText(item, t, language)}
          </TooltipContent>
        </Tooltip>
        <div className="md:hidden">
          <PendingReviewHelpButton item={item} t={t} language={language} />
        </div>
      </div>
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

  if (item.dashboardStatus === LISTING_APPROVAL_STATUS_VALUES.rejected) {
    return (
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Badge variant="outline" className={badgeClassName}>
                {label}
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8} className="hidden max-w-[260px] text-center leading-5 md:inline-flex">
            {getRejectedListingHelpText(item, t)}
          </TooltipContent>
        </Tooltip>
        <RejectedListingReasonButton item={item} t={t} />
      </div>
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

export function DashboardTableClient({ currentTab, ownedItems, favouriteItems, favouriteCount = 0 }) {
  const { t, language } = useLanguage();
  const [dashboardSearch, setDashboardSearch] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("");
  const [sortOrder, setSortOrder] = React.useState("newest");
  const [rowsPerPage, setRowsPerPage] = React.useState(7);
  const [currentPage, setCurrentPage] = React.useState(1);

  const normalizedDashboardSearch = dashboardSearch.trim().toLowerCase();
  const hasActiveFilters = Boolean(normalizedDashboardSearch || selectedCategory);
  const mobileOptionCount = Number(Boolean(selectedCategory)) + Number(sortOrder !== "newest");

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
    let matchingItems;

    if (currentTab === "all") {
      matchingItems = allItems;
    } else if (currentTab === "favourite") {
      matchingItems = filteredFavouriteItems;
    } else {
      matchingItems = filteredOwnedItems.filter((item) => item.dashboardStatus === currentTab);
    }

    return matchingItems.slice().sort((firstItem, secondItem) => {
      if (sortOrder === "oldest") {
        return new Date(firstItem.createdAt ?? 0) - new Date(secondItem.createdAt ?? 0);
      }

      if (sortOrder === "price-low") {
        return (firstItem.priceValue ?? 0) - (secondItem.priceValue ?? 0);
      }

      if (sortOrder === "price-high") {
        return (secondItem.priceValue ?? 0) - (firstItem.priceValue ?? 0);
      }

      return new Date(secondItem.createdAt ?? 0) - new Date(firstItem.createdAt ?? 0);
    });
  }, [allItems, currentTab, filteredFavouriteItems, filteredOwnedItems, sortOrder]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [dashboardSearch, currentTab, rowsPerPage, selectedCategory, sortOrder]);

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
      <div className="space-y-3 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3 md:space-y-0">
        <nav
          aria-label={t.status}
          className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden"
        >
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
                    ? "min-h-11 shrink-0 snap-start rounded-full px-3 dark:bg-white dark:text-zinc-950 dark:hover:bg-white/95"
                    : "min-h-11 shrink-0 snap-start rounded-full bg-white px-3 dark:bg-background"
                }
              >
                <Link
                  href={buildDashboardHref(tab.key)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`ml-0.5 min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold ${
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
        </nav>

        <div className="hidden flex-wrap gap-2 md:flex">
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

        <div className="flex items-center gap-2 md:hidden">
          <div className="min-w-0 flex-1">
            <DashboardSearchInput
              id="dashboard-search-mobile"
              value={dashboardSearch}
              onValueChange={setDashboardSearch}
            />
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" className="h-11 rounded-xl px-3">
                <SlidersHorizontalIcon className="size-4" />
                <span>{t.filters}</span>
                {mobileOptionCount > 0 ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white dark:bg-white dark:text-zinc-950">
                    {mobileOptionCount}
                  </span>
                ) : null}
              </Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              showCloseButton={false}
              className="max-h-[80svh] overflow-y-auto rounded-t-[1.75rem] pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <SheetHeader className="border-b border-zinc-200 px-4 pb-3 pt-4 text-left dark:border-border">
                <SheetTitle className="text-lg font-semibold">{t.filters}</SheetTitle>
                <SheetDescription>
                  {language === "fr"
                    ? "Les annonces se mettent à jour dès que vous choisissez une option."
                    : "Listings update as soon as you choose an option."}
                </SheetDescription>
              </SheetHeader>

              <div className="grid gap-4 px-4 py-2">
                <div className="min-w-0">
                  <Label htmlFor="dashboard-sort-mobile" className="mb-1.5 block text-xs">
                    {t.sortByLabel}
                  </Label>
                  <NativeSelect
                    id="dashboard-sort-mobile"
                    value={sortOrder}
                    onChange={(event) => setSortOrder(event.target.value)}
                    className="w-full"
                    size="sm"
                  >
                    <NativeSelectOption value="newest">{t.sortDateNewest}</NativeSelectOption>
                    <NativeSelectOption value="oldest">{t.sortDateOldest}</NativeSelectOption>
                    <NativeSelectOption value="price-low">{t.sortPriceLowHigh}</NativeSelectOption>
                    <NativeSelectOption value="price-high">{t.sortPriceHighLow}</NativeSelectOption>
                  </NativeSelect>
                </div>

                <DashboardCategoryFilter
                  id="dashboard-category-filter-mobile"
                  value={selectedCategory}
                  onValueChange={setSelectedCategory}
                  options={CATEGORY_OPTIONS}
                  className="md:w-full lg:w-full"
                  label={t.filterByCategoryLabel}
                  showLabel
                />
              </div>

              <SheetFooter className="grid grid-cols-2 border-t border-zinc-200 pt-3 dark:border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedCategory("");
                    setSortOrder("newest");
                  }}
                >
                  {t.clearFilters}
                </Button>
                <SheetClose asChild>
                  <Button type="button">{language === "fr" ? "Terminé" : "Done"}</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>

        <div className="hidden gap-2 md:flex md:items-center md:justify-end">
          <DashboardCategoryFilter
            id="dashboard-category-filter-desktop"
            value={selectedCategory}
            onValueChange={setSelectedCategory}
            options={CATEGORY_OPTIONS}
          />
          <DashboardSearchInput
            id="dashboard-search-desktop"
            value={dashboardSearch}
            onValueChange={setDashboardSearch}
          />
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
              className="rounded-[1.5rem] border border-zinc-200 bg-white p-3 shadow-sm dark:border-border dark:bg-card"
            >
              <div className="flex items-start gap-3">
                <Link href={`/listings/${item.slug}`} className="flex min-w-0 flex-1 items-start gap-3 rounded-xl transition hover:bg-zinc-50 dark:hover:bg-muted/40">
                  <div className="relative size-[60px] shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-muted">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.title}
                        fill
                        sizes="60px"
                        placeholder="blur"
                        blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
                        className="object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pr-1">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-950 dark:text-foreground">{item.title}</p>
                    <p className="mt-1 text-base font-bold text-zinc-950 dark:text-foreground">{item.price}</p>
                    {item.meta ? <p className="mt-1 truncate text-xs text-zinc-500 dark:text-muted-foreground">{item.meta}</p> : null}
                  </div>
                </Link>
                {showManagementActions ? (
                  <DashboardListingActions
                    id={item.id}
                    slug={item.slug}
                    title={item.title}
                    status={item.dashboardStatus}
                    submittedForReviewAt={item.submittedForReviewAt}
                    moderationReviewedAt={item.moderationReviewedAt}
                  />
                ) : null}
              </div>

              <div className="mt-3 flex min-h-11 items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-border">
                <DashboardStatusBadge item={item} label={getStatusLabel(item)} t={t} language={language} />
                {showMessagesColumn && item.messageCount > 0 ? (
                  <span className="text-xs text-zinc-500 dark:text-muted-foreground">
                    {item.messageCount}+ {t.messages}
                  </span>
                ) : null}
              </div>
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
              disabled={safePage === 1}
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
              disabled={safePage === totalPages}
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
                        <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-muted">
                          {item.imageUrl ? (
                            <Image
                              src={item.imageUrl}
                              alt={item.title}
                              fill
                              sizes="64px"
                              placeholder="blur"
                              blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
                              className="object-cover"
                            />
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
                      <DashboardStatusBadge item={item} label={getStatusLabel(item)} t={t} language={language} />
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
                        title={item.title}
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
                  <Button type="button" variant="outline" size="icon-sm" disabled={safePage === 1} onClick={() => setCurrentPage(1)}>
                    <span aria-hidden="true">«</span>
                  </Button>
                  <Button type="button" variant="outline" size="icon-sm" disabled={safePage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>
                    <span aria-hidden="true">‹</span>
                  </Button>
                  <Button type="button" variant="outline" size="icon-sm" disabled={safePage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>
                    <span aria-hidden="true">›</span>
                  </Button>
                  <Button type="button" variant="outline" size="icon-sm" disabled={safePage === totalPages} onClick={() => setCurrentPage(totalPages)}>
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
