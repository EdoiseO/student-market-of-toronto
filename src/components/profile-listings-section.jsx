"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, UserRound } from "lucide-react";

import { CardImage } from "@/components/card-image";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { useLanguage } from "@/context/LanguageContext";
import { getTranslatedCategoryTitle, normalizeCategoryValue } from "@/lib/categories";

function formatPrice(price, language) {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Number(price ?? 0));
}

function getCategorySlugFromValue(value) {
  return normalizeCategoryValue(value)
    .toLowerCase()
    .replace(/\s*&\s*/g, "-")
    .replace(/\s+/g, "-");
}

export function ProfileListingsSection({ listings, sellerSchool }) {
  const { t, language } = useLanguage();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState("");
  const [sortOrder, setSortOrder] = React.useState("newest");
  const scrollerRef = React.useRef(null);
  const [canScrollBack, setCanScrollBack] = React.useState(false);
  const [canScrollForward, setCanScrollForward] = React.useState(listings.length > 1);

  const categoryOptions = React.useMemo(() => {
    return [...new Set(listings.map((listing) => normalizeCategoryValue(listing.category)).filter(Boolean))];
  }, [listings]);

  const filteredListings = React.useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return listings
      .filter((listing) => {
        const normalizedCategory = normalizeCategoryValue(listing.category);
        const matchesCategory = !categoryFilter || normalizedCategory === categoryFilter;
        const matchesQuery =
          normalizedQuery.length === 0 || listing.title?.toLowerCase().includes(normalizedQuery);

        return matchesCategory && matchesQuery;
      })
      .sort((firstListing, secondListing) => {
        const firstTime = new Date(firstListing.created_at ?? 0).getTime();
        const secondTime = new Date(secondListing.created_at ?? 0).getTime();

        if (sortOrder === "oldest") {
          return firstTime - secondTime;
        }

        return secondTime - firstTime;
      });
  }, [categoryFilter, listings, searchQuery, sortOrder]);

  const updateScrollState = React.useCallback(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    setCanScrollBack(scroller.scrollLeft > 4);
    setCanScrollForward(scroller.scrollLeft < maxScrollLeft - 4);
  }, []);

  React.useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return undefined;
    }

    scroller.scrollTo({ left: 0 });
    updateScrollState();
    scroller.addEventListener("scroll", updateScrollState, { passive: true });

    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [filteredListings, updateScrollState]);

  function scrollListings(direction) {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    scroller.scrollBy({
      left: direction * Math.max(176, scroller.clientWidth * 0.8),
      behavior: "smooth",
    });
  }

  const previousListingsLabel =
    language === "fr" ? "Annonces précédentes du vendeur" : "Previous seller listings";
  const nextListingsLabel =
    language === "fr" ? "Annonces suivantes du vendeur" : "Next seller listings";
  const activeFilterCount = Number(Boolean(categoryFilter)) + Number(sortOrder !== "newest");

  function renderSortControl(id) {
    return (
      <div className="min-w-0">
        <Label htmlFor={id} className="mb-1.5 block text-xs">
          {t.sortListingsLabel}
        </Label>
        <NativeSelect
          id={id}
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          className="w-full"
          size="sm"
        >
          <NativeSelectOption value="newest">{t.newestFirst}</NativeSelectOption>
          <NativeSelectOption value="oldest">{t.oldestFirst}</NativeSelectOption>
        </NativeSelect>
      </div>
    );
  }

  function renderCategoryControl(id) {
    return (
      <div className="min-w-0">
        <Label htmlFor={id} className="mb-1.5 block text-xs">
          {t.filterByCategoryLabel}
        </Label>
        <NativeSelect
          id={id}
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="w-full"
          size="sm"
        >
          <NativeSelectOption value="">{t.allCategories}</NativeSelectOption>
          {categoryOptions.map((categoryValue) => (
            <NativeSelectOption key={categoryValue} value={categoryValue}>
              {getTranslatedCategoryTitle(
                getCategorySlugFromValue(categoryValue),
                t,
                language,
                categoryValue,
              )}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-col gap-2.5 sm:mb-4 sm:gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-2 sm:gap-3">
          <UserRound className="size-4 text-zinc-500 dark:text-muted-foreground sm:size-5" />
          <div>
            <h2 id="profile-active-listings-title" className="text-xl font-bold text-zinc-950 dark:text-foreground sm:text-2xl">{t.activeListingsTitle}</h2>
            <p className="text-xs leading-4 text-zinc-500 dark:text-muted-foreground sm:text-sm">{t.activeListingsDescription}</p>
          </div>
        </div>

        <div className="hidden w-full gap-2 md:flex md:flex-row md:items-end lg:ml-auto lg:flex-1 lg:justify-end">
          <div className="w-full max-w-[152px] [&_label]:sr-only">
            {renderSortControl("profile-listings-sort-desktop")}
          </div>

          <div className="w-full max-w-[168px] [&_label]:sr-only">
            {renderCategoryControl("profile-listings-category-desktop")}
          </div>

          <div className="w-full max-w-[240px] lg:w-[240px] lg:max-w-none">
            <Label htmlFor="profile-listings-search" className="sr-only">
              {t.searchListingsLabel}
            </Label>
            <Input
              id="profile-listings-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t.searchListingsPlaceholder}
              className="h-11 rounded-xl bg-white dark:bg-input/30"
            />
          </div>

          {filteredListings.length > 1 ? (
            <div className="hidden shrink-0 items-center gap-2 md:flex">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-[44px] min-h-[44px] w-[44px] min-w-[44px] rounded-full"
                aria-label={previousListingsLabel}
                disabled={!canScrollBack}
                onClick={() => scrollListings(-1)}
              >
                <ChevronLeft className="size-5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-[44px] min-h-[44px] w-[44px] min-w-[44px] rounded-full"
                aria-label={nextListingsLabel}
                disabled={!canScrollForward}
                onClick={() => scrollListings(1)}
              >
                <ChevronRight className="size-5" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 md:hidden">
        <div className="relative min-w-0 flex-1">
          <Label htmlFor="profile-listings-search-mobile" className="sr-only">
            {t.searchListingsLabel}
          </Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500 dark:text-muted-foreground" />
          <Input
            id="profile-listings-search-mobile"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t.searchListingsLabel}
            className="h-11 rounded-xl bg-white pl-9 text-base dark:bg-input/30"
          />
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" className="h-11 rounded-xl px-3">
              <SlidersHorizontal className="size-4" />
              <span>{t.filters}</span>
              {activeFilterCount > 0 ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white dark:bg-white dark:text-zinc-950">
                  {activeFilterCount}
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
              {renderSortControl("profile-listings-sort-mobile")}
              {renderCategoryControl("profile-listings-category-mobile")}
            </div>
            <SheetFooter className="grid grid-cols-2 border-t border-zinc-200 pt-3 dark:border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSortOrder("newest");
                  setCategoryFilter("");
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

      {filteredListings.length > 0 ? (
        <section
          ref={scrollerRef}
          role="list"
          aria-labelledby="profile-active-listings-title"
          className="-mx-1 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-1 pb-3 scroll-smooth overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {filteredListings.map((listing) => (
            <div
              key={listing.id}
              role="listitem"
              className="w-[calc((100%_-_0.75rem)/2)] max-w-48 min-w-0 flex-none snap-start self-start sm:w-44 md:w-48 lg:w-52 lg:max-w-52"
            >
              <CardImage
                badge={listing.badge}
                title={listing.title}
                price={formatPrice(listing.price, language)}
                meta={listing.location || sellerSchool || t.torontoMeetup}
                imageUrls={(listing.listing_images ?? []).map((image) => image.image_url)}
                href={`/listings/${listing.slug}`}
                imageAlt={listing.title}
                imageSizes="(max-width: 429px) calc((100vw - 3.75rem) / 2), (max-width: 639px) 192px, (max-width: 767px) 176px, (max-width: 1023px) 192px, 208px"
                compact
                rail
              />
            </div>
          ))}
        </section>
      ) : (
        <Card className="rounded-3xl border-zinc-200 bg-zinc-50 py-0 shadow-none dark:bg-muted/40 dark:ring-border">
          <CardHeader className="px-6 py-6">
            <CardTitle className="text-xl text-zinc-950 dark:text-foreground">{t.noListingsMatchFiltersTitle}</CardTitle>
            <CardDescription>{t.noListingsMatchFiltersDescription}</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setCategoryFilter("");
              }}
              className="text-sm font-medium text-zinc-900 underline underline-offset-4 dark:text-foreground"
            >
              {t.clearFilters}
            </button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
