import Link from "next/link";
import { cookies } from "next/headers";

import { CardImage } from "@/components/card-image";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { getTranslatedCategoryValue } from "@/lib/categories";
import {
  getNearbyPageNumbers,
  normalizeSearchQuery,
  parseCatalogPage,
} from "@/lib/catalog-pagination.mjs";
import { getListingBadgeKey } from "@/lib/listing-badges";
import {
  buildSearchHref,
  conditionOptions,
  formatPrice,
  getTranslatedConditionLabel,
  getTranslatedSortLabel,
  getTranslatedTagLabel,
  normalizeSearchRows,
  sortOptions,
} from "@/lib/search-listings";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

const SEARCH_ITEMS_PER_PAGE = 24;
const LISTING_IMAGE_LIMIT = 10;

function parseOptionalPrice(value) {
  if (value === "") {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export default async function SearchPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const currentParams = new URLSearchParams();

  Object.entries(resolvedSearchParams ?? {}).forEach(([key, value]) => {
    if (typeof value === "string" && value.length > 0) {
      currentParams.set(key, value);
    }
  });

  const query = normalizeSearchQuery(resolvedSearchParams?.q);
  if (query) {
    currentParams.set("q", query);
  } else {
    currentParams.delete("q");
  }
  const minPrice = resolvedSearchParams?.min ?? "";
  const maxPrice = resolvedSearchParams?.max ?? "";
  const condition = resolvedSearchParams?.condition ?? "";
  const tag = resolvedSearchParams?.tag ?? "";
  const sortBy = resolvedSearchParams?.sort ?? "new-old";
  const requestedPage = parseCatalogPage(resolvedSearchParams?.page);

  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const supabase = createClient(cookieStore);

  async function fetchListingIdPage(pageNumber) {
    return supabase
      .rpc("search_active_listing_page", {
        p_query: query || null,
        p_min_price: parseOptionalPrice(minPrice),
        p_max_price: parseOptionalPrice(maxPrice),
        p_condition: condition || null,
        p_tag: tag || null,
        p_sort: sortBy,
        p_offset: (pageNumber - 1) * SEARCH_ITEMS_PER_PAGE,
        p_limit: SEARCH_ITEMS_PER_PAGE,
      })
      .single();
  }

  let pageResult = await fetchListingIdPage(requestedPage);
  let totalCount = Number(pageResult.data?.total_count ?? 0);
  let isCountCapped = Boolean(pageResult.data?.is_count_capped);
  const totalPages = Math.max(1, Math.ceil(totalCount / SEARCH_ITEMS_PER_PAGE));
  const safePage = Math.min(requestedPage, totalPages);

  if (!pageResult.error && safePage !== requestedPage) {
    pageResult = await fetchListingIdPage(safePage);
    totalCount = Number(pageResult.data?.total_count ?? totalCount);
    isCountCapped = Boolean(pageResult.data?.is_count_capped);
  }

  const listingIds = pageResult.data?.listing_ids ?? [];
  const { data: rows, error: detailError } = listingIds.length > 0
    ? await supabase
        .from("listings")
        .select(`
          id,
          slug,
          title,
          price,
          previous_price,
          category,
          condition,
          location,
          status,
          is_featured,
          is_negotiable,
          created_at,
          listing_images (
            image_url,
            position
          )
        `)
        .in("id", listingIds)
        .eq("status", "active")
        .order("position", { referencedTable: "listing_images", ascending: true })
        .limit(LISTING_IMAGE_LIMIT, { referencedTable: "listing_images" })
        .limit(SEARCH_ITEMS_PER_PAGE)
    : { data: [], error: null };

  const listingsError = pageResult.error ?? detailError;
  if (listingsError) {
    console.error("Search listings query failed:", listingsError.message);
  }

  const rowById = new Map(normalizeSearchRows(rows).map((listing) => [listing.id, listing]));
  const filteredListings = listingIds.map((id) => rowById.get(id)).filter(Boolean);

  const activeFilters = [
    query ? { label: `${t.searchQueryFilterLabel}: ${query}`, key: "q" } : null,
    minPrice ? { label: `${t.minPriceFilterLabel}: $${minPrice}`, key: "min" } : null,
    maxPrice ? { label: `${t.maxPriceFilterLabel}: $${maxPrice}`, key: "max" } : null,
    condition
      ? { label: `${t.conditionLabel}: ${getTranslatedConditionLabel(condition, t)}`, key: "condition" }
      : null,
    tag ? { label: `${t.tagFilterLabel}: ${getTranslatedTagLabel(tag, t)}`, key: "tag" } : null,
    sortBy && sortBy !== "new-old"
      ? { label: `${t.sortFilterLabel}: ${getTranslatedSortLabel(sortBy, t)}`, key: "sort" }
      : null,
  ].filter(Boolean);

  return (
    <main className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-5 dark:bg-background md:p-8">
      <div className="sticky top-16 z-40 -mx-4 -mt-5 border-b border-border bg-background/95 px-4 py-3 shadow-sm backdrop-blur md:hidden">
        <SearchForm className="w-full [&_input]:h-11 [&_input]:bg-background [&_input]:text-base" />
        <div
          aria-label={t.filters}
          className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {conditionOptions.map((option) => {
            const isActive = condition === option.value;
            const label = option.value
              ? getTranslatedConditionLabel(option.value, t)
              : t.allConditions;

            return (
              <Link
                key={option.value || "all-conditions"}
                href={buildSearchHref("/search", currentParams, { condition: option.value })}
                aria-current={isActive ? "true" : undefined}
                className={`flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-accent"
                }`}
              >
                {label}
              </Link>
            );
          })}
          {sortOptions.map((option) => {
            const isActive = sortBy === option.value;

            return (
              <Link
                key={option.value}
                href={buildSearchHref("/search", currentParams, { sort: option.value })}
                aria-current={isActive ? "true" : undefined}
                className={`flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-accent"
                }`}
              >
                {getTranslatedSortLabel(option.value, t)}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mx-auto flex min-w-0 w-full max-w-[1440px] flex-col gap-6 pt-5 md:pt-0">
        <section className="space-y-5">
            <Card className="rounded-2xl border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border md:rounded-[2rem]">
              <CardContent className="space-y-3 px-4 py-3.5 md:space-y-4 md:p-6">
                <div className="flex items-end justify-between gap-3 md:items-center">
                  <div>
                    <p className="text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-muted-foreground md:text-sm md:tracking-[0.18em]">
                      {t.results}
                    </p>
                    <h2 className="mt-0.5 text-lg font-bold leading-tight text-zinc-950 dark:text-foreground md:mt-0 md:text-2xl">
                      {totalCount} {totalCount === 1 ? t.listingResultSingular : t.listingResultPlural}
                    </h2>
                    {isCountCapped ? (
                      <p className="mt-1 text-xs text-zinc-500 dark:text-muted-foreground">
                        {language === "fr"
                          ? "Résultats parmi les 1 200 annonces actives les plus récentes."
                          : "Results within the 1,200 newest active listings."}
                      </p>
                    ) : null}
                  </div>
                  <div className="max-w-[52%] text-right text-xs leading-4 text-zinc-500 dark:text-muted-foreground md:max-w-none md:text-sm md:leading-normal">
                    {query ? `${t.showingMatchesFor} “${query}”` : t.showingAllActiveListings}
                  </div>
                </div>

                {activeFilters.length > 0 ? (
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden">
                    {activeFilters.map((filter) => (
                      <Badge key={filter.key} variant="secondary" className="min-h-11 shrink-0 bg-zinc-100 px-3 text-zinc-800 dark:bg-muted dark:text-foreground">
                        <span>{filter.label}</span>
                        <Link href={buildSearchHref("/search", currentParams, { [filter.key]: "" })} aria-label={`${t.clearText}: ${filter.label}`} className="ml-2 inline-flex size-11 items-center justify-center rounded-full text-zinc-500 hover:bg-background hover:text-zinc-900 dark:text-muted-foreground dark:hover:text-foreground">
                          ✕
                        </Link>
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <section className="min-w-0 rounded-3xl bg-zinc-50 p-4 shadow-sm ring-1 ring-zinc-200 dark:bg-muted/40 dark:ring-border md:p-8">
              {listingsError ? (
                <div role="alert" className="rounded-[1.5rem] border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-border dark:bg-card">
                  <p className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                    {language === "fr"
                      ? "La recherche est temporairement indisponible."
                      : "Search is temporarily unavailable."}
                  </p>
                  <p className="mt-2 text-sm text-zinc-500 dark:text-muted-foreground">
                    {language === "fr"
                      ? "Réessayez dans un instant ou modifiez vos filtres."
                      : "Try again in a moment or adjust your filters."}
                  </p>
                </div>
              ) : filteredListings.length > 0 ? (
                <>
                  <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-6">
                    {filteredListings.map((item) => (
                      <CardImage
                        key={item.id}
                        badge={getListingBadgeKey(item)}
                        title={item.title}
                        price={formatPrice(item.price)}
                        meta={item.location || getTranslatedCategoryValue(item.category, t, language)}
                        imageUrls={(item.listing_images ?? []).map((image) => image.image_url)}
                        imageAlt={item.title}
                        imageSizes="(max-width: 767px) calc((100vw - 4rem) / 2), (max-width: 1023px) calc((100vw - 27rem) / 2), (max-width: 1279px) calc((100vw - 29rem) / 3), (max-width: 1535px) 16vw, 220px"
                        href={`/listings/${item.slug}`}
                        compact
                      />
                    ))}
                  </div>

                  {totalPages > 1 ? (
                    <Pagination className="mt-8">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            href={buildSearchHref("/search", currentParams, {
                              page: Math.max(safePage - 1, 1),
                            })}
                            className={safePage === 1 ? "pointer-events-none opacity-50" : ""}
                            aria-disabled={safePage === 1}
                          />
                        </PaginationItem>
                        {safePage > 2 ? (
                          <>
                            <PaginationItem>
                              <PaginationLink href={buildSearchHref("/search", currentParams, { page: 1 })}>
                                1
                              </PaginationLink>
                            </PaginationItem>
                            {safePage > 3 ? (
                              <PaginationItem>
                                <PaginationEllipsis />
                              </PaginationItem>
                            ) : null}
                          </>
                        ) : null}
                        {getNearbyPageNumbers(safePage, totalPages)
                          .map((pageNumber) => (
                            <PaginationItem key={pageNumber}>
                              <PaginationLink
                                href={buildSearchHref("/search", currentParams, { page: pageNumber })}
                                isActive={pageNumber === safePage}
                              >
                                {pageNumber}
                              </PaginationLink>
                            </PaginationItem>
                          ))}
                        {safePage < totalPages - 1 ? (
                          <>
                            {safePage < totalPages - 2 ? (
                              <PaginationItem>
                                <PaginationEllipsis />
                              </PaginationItem>
                            ) : null}
                            <PaginationItem>
                              <PaginationLink href={buildSearchHref("/search", currentParams, { page: totalPages })}>
                                {totalPages}
                              </PaginationLink>
                            </PaginationItem>
                          </>
                        ) : null}
                        <PaginationItem>
                          <PaginationNext
                            href={buildSearchHref("/search", currentParams, {
                              page: Math.min(safePage + 1, totalPages),
                            })}
                            className={safePage === totalPages ? "pointer-events-none opacity-50" : ""}
                            aria-disabled={safePage === totalPages}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  ) : null}
                </>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-border dark:bg-card">
                  <p className="text-lg font-semibold text-zinc-950 dark:text-foreground">{t.noSearchResultsTitle}</p>
                  <p className="mt-2 text-sm text-zinc-500 dark:text-muted-foreground">
                    {t.noSearchResultsDescription}
                  </p>
                </div>
              )}
            </section>
          </section>
      </div>
    </main>
  );
}
