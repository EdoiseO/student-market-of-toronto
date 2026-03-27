import Link from "next/link";
import { cookies } from "next/headers";

import { CardImage } from "@/components/card-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildSearchHref,
  formatPrice,
  getListingBadge,
  matchesTag,
  normalizeSearchRows,
  sortOptions,
} from "@/lib/search-listings";
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
    query ? { label: `Search: ${query}`, key: "q" } : null,
    minPrice ? { label: `Min: $${minPrice}`, key: "min" } : null,
    maxPrice ? { label: `Max: $${maxPrice}`, key: "max" } : null,
    condition ? { label: `Condition: ${condition}`, key: "condition" } : null,
    tag ? { label: `Tag: ${tag}`, key: "tag" } : null,
    sortBy && sortBy !== "new-old"
      ? { label: `Sort: ${sortOptions.find((option) => option.value === sortBy)?.label ?? sortBy}`, key: "sort" }
      : null,
  ].filter(Boolean);

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-6">
        <section className="space-y-5">
            <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm">
              <CardContent className="space-y-4 p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
                      Results
                    </p>
                    <h2 className="text-2xl font-bold text-zinc-950">
                      {filteredListings.length} listing{filteredListings.length === 1 ? "" : "s"} found
                    </h2>
                  </div>
                  <div className="text-sm text-zinc-500">
                    {query ? `Showing matches for “${query}”` : "Showing all active listings"}
                  </div>
                </div>

                {activeFilters.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {activeFilters.map((filter) => (
                      <Badge key={filter.key} variant="secondary" className="bg-zinc-100 text-zinc-800">
                        <span>{filter.label}</span>
                        <Link href={buildSearchHref("/search", currentParams, { [filter.key]: "" })} className="ml-2 text-zinc-500 hover:text-zinc-900">
                          ✕
                        </Link>
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <section className="rounded-[2rem] bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200">
              {filteredListings.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {filteredListings.map((item) => (
                    <CardImage
                      key={item.id}
                      badge={getListingBadge(item)}
                      title={item.title}
                      price={formatPrice(item.price)}
                      meta={item.location || item.category}
                      imageUrls={(item.listing_images ?? []).map((image) => image.image_url)}
                      imageUrl={item.listing_images?.[0]?.image_url ?? null}
                      imageAlt={item.title}
                      href={`/listings/${item.slug}`}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
                  <p className="text-lg font-semibold text-zinc-950">No results yet</p>
                  <p className="mt-2 text-sm text-zinc-500">
                    Try adjusting your filters or clearing the current search.
                  </p>
                </div>
              )}
            </section>
          </section>
      </div>
    </main>
  );
}
