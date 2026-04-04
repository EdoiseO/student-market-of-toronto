import Link from "next/link";
import { cookies } from "next/headers";

import { CardImage } from "@/components/card-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getTranslatedCategoryValue } from "@/lib/categories";
import {
  buildSearchHref,
  formatPrice,
  getTranslatedConditionLabel,
  getListingBadge,
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
      description,
      price,
      previous_price,
      category,
      condition,
      location,
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
    listingsQuery = listingsQuery.or(
      `title.ilike.%${query}%,description.ilike.%${query}%,category.ilike.%${query}%,location.ilike.%${query}%`
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

  const { data: rows = [] } = await listingsQuery;

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
    <main className="min-h-screen bg-zinc-100 p-6 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
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
                  <div className="flex flex-wrap gap-2">
                    {activeFilters.map((filter) => (
                      <Badge key={filter.key} variant="secondary" className="bg-zinc-100 text-zinc-800 dark:bg-muted dark:text-foreground">
                        <span>{filter.label}</span>
                        <Link href={buildSearchHref("/search", currentParams, { [filter.key]: "" })} className="ml-2 text-zinc-500 hover:text-zinc-900 dark:text-muted-foreground dark:hover:text-foreground">
                          ✕
                        </Link>
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <section className="rounded-[2rem] bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 dark:bg-muted/40 dark:ring-border">
              {filteredListings.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {filteredListings.map((item) => (
                    <CardImage
                      key={item.id}
                      badge={getListingBadge(item)}
                      title={item.title}
                      price={formatPrice(item.price)}
                      meta={item.location || getTranslatedCategoryValue(item.category, t, language)}
                      imageUrls={(item.listing_images ?? []).map((image) => image.image_url)}
                      imageUrl={item.listing_images?.[0]?.image_url ?? null}
                      imageAlt={item.title}
                      href={`/listings/${item.slug}`}
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
