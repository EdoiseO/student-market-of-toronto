import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import { CardImage } from "@/components/card-image";
import { getCategoryBySlug, getCategoryValuesBySlug } from "@/lib/categories";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const ITEMS_PER_PAGE = 6;
const NEW_LISTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function buildCategoryPageHref(slug, pageNumber) {
  return pageNumber === 1 ? `/categories/${slug}` : `/categories/${slug}?page=${pageNumber}`;
}

function getListingBadge(listing) {
  if (listing.is_featured) {
    return "Featured";
  }

  const createdAt = new Date(listing.created_at).getTime();

  if (!Number.isNaN(createdAt) && Date.now() - createdAt <= NEW_LISTING_WINDOW_MS) {
    return "New";
  }

  return undefined;
}

function CategoryListingGrid({ items }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <CardImage
          key={item.id}
          badge={getListingBadge(item)}
          title={item.title}
          price={`$${Number(item.price).toFixed(2)}`}
          meta={item.location ?? ""}
          imageUrl={item.listing_images?.[0]?.image_url ?? null}
          href={`/listings/${item.slug}`}
          imageAlt={item.title}
        />
      ))}
    </div>
  );
}

export default async function CategoryPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const section = getCategoryBySlug(resolvedParams.slug);
  const categoryValues = getCategoryValuesBySlug(resolvedParams.slug);

  if (!section || categoryValues.length === 0) {
    notFound();
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: allItems } = await supabase
    .from("listings")
    .select(`
      id,
      slug,
      title,
      price,
      location,
      is_featured,
      created_at,
      listing_images (
        image_url,
        position
      )
    `)
    .in("category", categoryValues)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const listings = (allItems ?? []).map((listing) => ({
    ...listing,
    listing_images: (listing.listing_images ?? []).sort(
      (firstImage, secondImage) => firstImage.position - secondImage.position
    ),
  }));
  const featuredItems = listings.filter((item) => item.is_featured);
  const newItems = listings
    .filter((item) => getListingBadge(item) === "New")
    .slice(0, 5);

  const requestedPage = Number.parseInt(resolvedSearchParams?.page ?? "1", 10);
  const currentPage = Number.isNaN(requestedPage) || requestedPage < 1 ? 1 : requestedPage;
  const totalPages = Math.max(1, Math.ceil(listings.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const paginatedItems = listings.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-950">
            {section.title}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-zinc-600">
            Browse student listings in this category, check out featured picks,
            spot newly added items, and explore everything currently available.
          </p>
        </section>

        {featuredItems.length > 0 ? (
          <section className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-zinc-950">Featured Items</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Highlighted listings students are likely to notice first.
              </p>
            </div>
            <CategoryListingGrid items={featuredItems} />
          </section>
        ) : null}

        {newItems.length > 0 ? (
          <section className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-zinc-950">New Items</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Recently added listings in {section.title.toLowerCase()}.
              </p>
            </div>
            <CategoryListingGrid items={newItems} />
          </section>
        ) : null}

        <section className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
          <div className="mb-5">
            <h2 className="text-2xl font-bold text-zinc-950">All Available Items</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Every listing currently shown in this category.
            </p>
          </div>

          {paginatedItems.length > 0 ? (
            <CategoryListingGrid items={paginatedItems} />
          ) : (
            <p className="text-sm text-zinc-500">
              No listings available in this category yet.
            </p>
          )}

          {totalPages > 1 ? (
            <Pagination className="mt-8">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href={buildCategoryPageHref(resolvedParams.slug, Math.max(safePage - 1, 1))}
                    className={safePage === 1 ? "pointer-events-none opacity-50" : ""}
                    aria-disabled={safePage === 1}
                  />
                </PaginationItem>

                {safePage > 2 && totalPages > 3 ? (
                  <>
                    <PaginationItem>
                      <PaginationLink href={buildCategoryPageHref(resolvedParams.slug, 1)}>
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

                {Array.from({ length: totalPages }, (_, index) => index + 1)
                  .filter((pageNumber) => {
                    if (totalPages <= 3) {
                      return true;
                    }

                    return Math.abs(pageNumber - safePage) <= 1;
                  })
                  .map((pageNumber) => (
                    <PaginationItem key={pageNumber}>
                      <PaginationLink
                        href={buildCategoryPageHref(resolvedParams.slug, pageNumber)}
                        isActive={pageNumber === safePage}
                      >
                        {pageNumber}
                      </PaginationLink>
                    </PaginationItem>
                  ))}

                {safePage < totalPages - 1 && totalPages > 3 ? (
                  <>
                    {safePage < totalPages - 2 ? (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : null}
                    <PaginationItem>
                      <PaginationLink href={buildCategoryPageHref(resolvedParams.slug, totalPages)}>
                        {totalPages}
                      </PaginationLink>
                    </PaginationItem>
                  </>
                ) : null}

                <PaginationItem>
                  <PaginationNext
                    href={buildCategoryPageHref(
                      resolvedParams.slug,
                      Math.min(safePage + 1, totalPages)
                    )}
                    className={safePage === totalPages ? "pointer-events-none opacity-50" : ""}
                    aria-disabled={safePage === totalPages}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </section>
      </div>
    </main>
  );
}
