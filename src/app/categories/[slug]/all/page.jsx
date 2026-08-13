import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { CardImage } from "@/components/card-image";
import { getListingBadgeKey } from "@/lib/listing-badges";
import { getNearbyPageNumbers, parseCatalogPage } from "@/lib/catalog-pagination.mjs";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";
import {
  getCategoryBySlug,
  getCategoryValuesBySlug,
  getTranslatedCategoryTitle,
} from "@/lib/categories";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const ITEMS_PER_PAGE = 18;
const LISTING_IMAGE_LIMIT = 10;

function buildCategoryAllPageHref(slug, pageNumber) {
  return pageNumber === 1
    ? `/categories/${slug}/all`
    : `/categories/${slug}/all?page=${pageNumber}`;
}

export default async function CategoryAllPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const section = getCategoryBySlug(resolvedParams.slug);
  const categoryValues = getCategoryValuesBySlug(resolvedParams.slug);

  if (!section || categoryValues.length === 0) {
    notFound();
  }

  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const supabase = createClient(cookieStore);
  const categoryTitle = getTranslatedCategoryTitle(
    resolvedParams.slug,
    t,
    language,
    section.title
  );
  const countQuery = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .in("category", categoryValues)
    .eq("status", "active");

  if (countQuery.error) {
    console.error("Failed to count category listings:", countQuery.error.message);
  }

  const listingCount = countQuery.count ?? 0;
  const currentPage = parseCatalogPage(resolvedSearchParams?.page);
  const totalPages = Math.max(1, Math.ceil(listingCount / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;

  const { data: pageItems, error: pageItemsError } = await supabase
    .from("listings")
    .select(`
      id,
      slug,
      title,
      price,
      previous_price,
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
    .in("category", categoryValues)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .order("position", { referencedTable: "listing_images", ascending: true })
    .limit(LISTING_IMAGE_LIMIT, { referencedTable: "listing_images" })
    .range(startIndex, startIndex + ITEMS_PER_PAGE - 1);

  if (pageItemsError) {
    console.error("Failed to load category listing page:", pageItemsError.message);
  }

  const paginatedItems = (pageItems ?? []).map((listing) => ({
    ...listing,
    listing_images: (listing.listing_images ?? []).sort(
      (firstImage, secondImage) => firstImage.position - secondImage.position
    ),
  }));

  return (
    <main className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-6 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border md:p-8">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-foreground md:text-4xl">
            {language === "fr" ? `Toutes les annonces de ${categoryTitle}` : `All ${categoryTitle} Listings`}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-zinc-600 dark:text-muted-foreground">
            {language === "fr"
              ? "Parcourez toutes les annonces actives actuellement disponibles dans cette catégorie."
              : "Browse every active listing currently available in this category."}
          </p>
        </section>

        <section className="rounded-3xl bg-zinc-50 p-4 shadow-sm ring-1 ring-zinc-200 dark:bg-muted/40 dark:ring-border md:p-6">
          {paginatedItems.length > 0 ? (
            <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-6">
              {paginatedItems.map((item) => (
                <CardImage
                  key={item.id}
                  badge={getListingBadgeKey(item)}
                  title={item.title}
                  price={`$${Number(item.price).toFixed(2)}`}
                  meta={item.location ?? ""}
                  imageUrls={(item.listing_images ?? []).map((image) => image.image_url)}
                  href={`/listings/${item.slug}`}
                  imageAlt={item.title}
                  imageSizes="(max-width: 767px) calc((100vw - 5rem) / 2), (max-width: 1023px) calc((100vw - 27rem) / 2), (max-width: 1279px) calc((100vw - 29rem) / 3), (max-width: 1535px) 16vw, 220px"
                  compact
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-muted-foreground">
              {t.noListings}
            </p>
          )}

          {totalPages > 1 ? (
            <Pagination className="mt-8">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href={buildCategoryAllPageHref(resolvedParams.slug, Math.max(safePage - 1, 1))}
                    className={safePage === 1 ? "pointer-events-none opacity-50" : ""}
                    aria-disabled={safePage === 1}
                  />
                </PaginationItem>

                {safePage > 2 && totalPages > 3 ? (
                  <>
                    <PaginationItem>
                      <PaginationLink href={buildCategoryAllPageHref(resolvedParams.slug, 1)}>
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
                        href={buildCategoryAllPageHref(resolvedParams.slug, pageNumber)}
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
                      <PaginationLink href={buildCategoryAllPageHref(resolvedParams.slug, totalPages)}>
                        {totalPages}
                      </PaginationLink>
                    </PaginationItem>
                  </>
                ) : null}

                <PaginationItem>
                  <PaginationNext
                    href={buildCategoryAllPageHref(
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
