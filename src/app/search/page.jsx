import Link from "next/link";
import { cookies } from "next/headers";

import { CardImage } from "@/components/card-image";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getTranslatedCategoryValue } from "@/lib/categories";
import { getListingBadgeKey } from "@/lib/listing-badges";
import {
  buildPostgrestIlikePattern,
  buildSearchHref,
  conditionOptions,
  formatPrice,
  getTranslatedConditionLabel,
  getTranslatedSortLabel,
  getTranslatedTagLabel,
  matchesTag,
  normalizeSearchRows,
  sortOptions,
} from "@/lib/search-listings";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

export default async function SearchPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const currentParams = new URLSearchParams();

  Object.entries(resolvedSearchParams ?? {}).forEach(([key, value]) => {
    if (typeof value === "string" && value.length > 0) {
      currentParams.set(key, value);
    }
  });

  const query = resolvedSearchParams?.q?.trim() ?? "";
  const minPrice = resolvedSearchParams?.min ?? "";
  const maxPrice = resolvedSearchParams?.max ?? "";
  const condition = resolvedSearchParams?.condition ?? "";
  const tag = resolvedSearchParams?.tag ?? "";
  const sortBy = resolvedSearchParams?.sort ?? "new-old";

  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const supabase = createClient(cookieStore);

  let listingsQuery = supabase
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
    .eq("status", "active");

  if (query) {
    const searchPattern = buildPostgrestIlikePattern(query);
    listingsQuery = listingsQuery.or(
      `title.ilike.${searchPattern},description.ilike.${searchPattern},category.ilike.${searchPattern},location.ilike.${searchPattern}`
    );
  }

  if (condition) {
    listingsQuery = listingsQuery.eq("condition", condition);
  }

  if (minPrice) {
    listingsQuery = listingsQuery.gte("price", Number(minPrice));
  }

  if (maxPrice) {
    listingsQuery = listingsQuery.lte("price", Number(maxPrice));
  }

  if (sortBy === "old-new") {
    listingsQuery = listingsQuery.order("created_at", { ascending: true });
  } else if (sortBy === "price-low-high") {
    listingsQuery = listingsQuery.order("price", { ascending: true });
  } else if (sortBy === "price-high-low") {
    listingsQuery = listingsQuery.order("price", { ascending: false });
  } else {
    listingsQuery = listingsQuery.order("created_at", { ascending: false });
  }

  const { data: rows, error: listingsError } = await listingsQuery;

  if (listingsError) {
    console.error("Search listings query failed:", listingsError.message);
  }

  const normalizedRows = normalizeSearchRows(rows);

  const filteredListings = tag
    ? normalizedRows.filter((listing) => matchesTag(listing, tag))
    : normalizedRows;

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
            <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
              <CardContent className="space-y-4 p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-muted-foreground">
                      {t.results}
                    </p>
                    <h2 className="text-2xl font-bold text-zinc-950 dark:text-foreground">
                      {filteredListings.length} {filteredListings.length === 1 ? t.listingResultSingular : t.listingResultPlural}
                    </h2>
                  </div>
                  <div className="text-sm text-zinc-500 dark:text-muted-foreground">
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
                <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredListings.map((item) => (
                    <CardImage
                      key={item.id}
                      badge={getListingBadgeKey(item)}
                      title={item.title}
                      price={formatPrice(item.price)}
                      meta={item.location || getTranslatedCategoryValue(item.category, t, language)}
                      imageUrls={(item.listing_images ?? []).map((image) => image.image_url)}
                      imageAlt={item.title}
                      imageSizes="(max-width: 767px) calc((100vw - 4rem) / 2), (max-width: 1023px) calc((100vw - 27rem) / 2), (max-width: 1279px) calc((100vw - 29rem) / 3), 25vw"
                      href={`/listings/${item.slug}`}
                      compact
                    />
                  ))}
                </div>
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
