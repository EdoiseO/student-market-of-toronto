"use client";

import * as React from "react";
import { UserRound } from "lucide-react";

import { CardImage } from "@/components/card-image";
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
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useLanguage } from "@/context/LanguageContext";
import { getTranslatedCategoryTitle, normalizeCategoryValue } from "@/lib/categories";

const PROFILE_LISTINGS_PER_PAGE = 24;

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
  const [currentPage, setCurrentPage] = React.useState(1);

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

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredListings.length / PROFILE_LISTINGS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedListings = React.useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * PROFILE_LISTINGS_PER_PAGE;
    return filteredListings.slice(startIndex, startIndex + PROFILE_LISTINGS_PER_PAGE);
  }, [filteredListings, safeCurrentPage]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <UserRound className="size-5 text-zinc-500" />
          <div>
            <h2 className="text-2xl font-bold text-zinc-950">{t.activeListingsTitle}</h2>
            <p className="text-sm text-zinc-500">{t.activeListingsDescription}</p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row lg:ml-auto lg:flex-1 lg:justify-end lg:items-center lg:gap-2">
          <div className="w-full sm:max-w-[152px]">
            <Label htmlFor="profile-listings-sort" className="sr-only">
              {t.sortListingsLabel}
            </Label>
            <NativeSelect
              id="profile-listings-sort"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              className="w-full"
            >
              <NativeSelectOption value="newest">{t.newestFirst}</NativeSelectOption>
              <NativeSelectOption value="oldest">{t.oldestFirst}</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="w-full sm:max-w-[168px]">
            <Label htmlFor="profile-listings-category" className="sr-only">
              {t.filterByCategoryLabel}
            </Label>
            <NativeSelect
              id="profile-listings-category"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="w-full"
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

          <div className="w-full sm:max-w-[240px] lg:w-[240px] lg:max-w-none">
            <Label htmlFor="profile-listings-search" className="sr-only">
              {t.searchListingsLabel}
            </Label>
            <Input
              id="profile-listings-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t.searchListingsPlaceholder}
              className="h-10 rounded-xl bg-white"
            />
          </div>
        </div>
      </div>

      {filteredListings.length > 0 ? (
        <>
          <div className="grid gap-5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {paginatedListings.map((listing) => (
              <CardImage
                key={listing.id}
                badge={listing.badge}
                title={listing.title}
                price={formatPrice(listing.price, language)}
                meta={listing.location || sellerSchool || t.torontoMeetup}
                imageUrls={(listing.listing_images ?? []).map((image) => image.image_url)}
                imageUrl={listing.listing_images?.[0]?.image_url ?? null}
                href={`/listings/${listing.slug}`}
                imageAlt={listing.title}
              />
            ))}
          </div>

          {totalPages > 1 ? (
            <Pagination className="mt-8">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    text={t.previousPage}
                    className={safeCurrentPage === 1 ? "pointer-events-none opacity-50" : ""}
                    aria-disabled={safeCurrentPage === 1}
                    onClick={(event) => {
                      event.preventDefault();

                      if (safeCurrentPage === 1) {
                        return;
                      }

                      setCurrentPage((page) => Math.max(1, page - 1));
                    }}
                  />
                </PaginationItem>

                {safeCurrentPage > 2 && totalPages > 3 ? (
                  <>
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          setCurrentPage(1);
                        }}
                      >
                        1
                      </PaginationLink>
                    </PaginationItem>
                    {safeCurrentPage > 3 ? (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : null}
                  </>
                ) : null}

                {Array.from({ length: totalPages }, (_, index) => index + 1)
                  .filter((pageNumber) => {
                    if (totalPages <= 3) {
                      return true;
                    }

                    return Math.abs(pageNumber - safeCurrentPage) <= 1;
                  })
                  .map((pageNumber) => (
                    <PaginationItem key={pageNumber}>
                      <PaginationLink
                        href="#"
                        isActive={pageNumber === safeCurrentPage}
                        onClick={(event) => {
                          event.preventDefault();
                          setCurrentPage(pageNumber);
                        }}
                      >
                        {pageNumber}
                      </PaginationLink>
                    </PaginationItem>
                  ))}

                {safeCurrentPage < totalPages - 1 && totalPages > 3 ? (
                  <>
                    {safeCurrentPage < totalPages - 2 ? (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : null}
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          setCurrentPage(totalPages);
                        }}
                      >
                        {totalPages}
                      </PaginationLink>
                    </PaginationItem>
                  </>
                ) : null}

                <PaginationItem>
                  <PaginationNext
                    href="#"
                    text={t.nextPage}
                    className={safeCurrentPage === totalPages ? "pointer-events-none opacity-50" : ""}
                    aria-disabled={safeCurrentPage === totalPages}
                    onClick={(event) => {
                      event.preventDefault();

                      if (safeCurrentPage === totalPages) {
                        return;
                      }

                      setCurrentPage((page) => Math.min(totalPages, page + 1));
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </>
      ) : (
        <Card className="rounded-3xl border-zinc-200 bg-zinc-50 py-0 shadow-none">
          <CardHeader className="px-6 py-6">
            <CardTitle className="text-xl text-zinc-950">{t.noListingsMatchFiltersTitle}</CardTitle>
            <CardDescription>{t.noListingsMatchFiltersDescription}</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setCategoryFilter("");
              }}
              className="text-sm font-medium text-zinc-900 underline underline-offset-4"
            >
              {t.clearFilters}
            </button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
