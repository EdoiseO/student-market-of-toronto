import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { CardImage } from "@/components/card-image";
import { getListingBadgeKey } from "@/lib/listing-badges";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";
import {
  getCategoryBySlug,
  getCategoryValuesBySlug,
  getTranslatedCategoryTitle,
} from "@/lib/categories";

const SECTION_ITEM_LIMIT = 6;

function normalizeListings(rows = []) {
  return rows.map((listing) => ({
    ...listing,
    listing_images: (listing.listing_images ?? []).sort(
      (firstImage, secondImage) => firstImage.position - secondImage.position
    ),
    view_count: Number(listing.view_count ?? 0),
  }));
}

function getHotScore(listing) {
  const createdAt = new Date(listing.created_at).getTime();
  const ageInDays = Number.isNaN(createdAt)
    ? 365
    : Math.max(1, (Date.now() - createdAt) / (1000 * 60 * 60 * 24));

  return listing.view_count / ageInDays;
}

function pickUniqueListings(candidates, limit, usedIds) {
  const selectedItems = [];

  for (const listing of candidates) {
    if (usedIds.has(listing.id)) {
      continue;
    }

    usedIds.add(listing.id);
    selectedItems.push(listing);

    if (selectedItems.length === limit) {
      break;
    }
  }

  return selectedItems;
}

function getAllListingsPreview(listings, limit, usedIds) {
  const previewItems = listings.filter((listing) => !usedIds.has(listing.id)).slice(0, limit);

  if (previewItems.length === limit) {
    return previewItems;
  }

  const previewIds = new Set(previewItems.map((listing) => listing.id));

  for (const listing of listings) {
    if (previewIds.has(listing.id)) {
      continue;
    }

    previewItems.push(listing);

    if (previewItems.length === limit) {
      break;
    }
  }

  return previewItems;
}

function CategoryListingGrid({ items }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <CardImage
          key={item.id}
          badge={getListingBadgeKey(item)}
          title={item.title}
          price={`$${Number(item.price).toFixed(2)}`}
          meta={item.location ?? ""}
          imageUrls={(item.listing_images ?? []).map((image) => image.image_url)}
          imageUrl={item.listing_images?.[0]?.image_url ?? null}
          href={`/listings/${item.slug}`}
          imageAlt={item.title}
        />
      ))}
    </div>
  );
}

function CategorySection({ title, description, items, href }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 dark:bg-muted/40 dark:ring-border md:p-8">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          {href ? (
            <Link
              href={href}
              className="inline-flex items-center gap-2 text-2xl font-bold text-zinc-950 transition-colors hover:text-zinc-700 dark:text-foreground dark:hover:text-foreground/80"
            >
              <span>{title}</span>
              <span aria-hidden="true">➔</span>
            </Link>
          ) : (
            <h2 className="text-2xl font-bold text-zinc-950 dark:text-foreground">{title}</h2>
          )}
          <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">{description}</p>
        </div>
      </div>
      <CategoryListingGrid items={items} />
    </section>
  );
}

export default async function CategoryPage({ params }) {
  const resolvedParams = await params;

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
  const categoryTitleLower = categoryTitle.toLowerCase();
  const { data: allItems } = await supabase
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
      view_count,
      listing_images (
        image_url,
        position
      )
    `)
    .in("category", categoryValues)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const listings = normalizeListings(allItems);
  const usedIds = new Set();

  const promotedItems = pickUniqueListings(
    listings.filter((item) => item.is_featured),
    SECTION_ITEM_LIMIT,
    usedIds,
  );

  const trendingItems = pickUniqueListings(
    [...listings].sort((firstItem, secondItem) => getHotScore(secondItem) - getHotScore(firstItem)),
    SECTION_ITEM_LIMIT,
    usedIds,
  );

  const recentlyAddedItems = pickUniqueListings(
    listings,
    SECTION_ITEM_LIMIT,
    usedIds,
  );

  const allAvailablePreview = getAllListingsPreview(listings, SECTION_ITEM_LIMIT, usedIds);

  return (
    <main className="min-h-screen bg-zinc-100 p-6 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-950 dark:text-foreground">
            {categoryTitle}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-zinc-600 dark:text-muted-foreground">
            {t.categoryPageDescription}
          </p>
        </section>

        {listings.length > 0 ? (
          <>
            <CategorySection
              title={t.promoted}
              description={
                language === "fr"
                  ? `Les annonces à la une à découvrir en priorité dans ${categoryTitleLower}.`
                  : `Featured listings we want students to notice first in ${categoryTitleLower}.`
              }
              items={promotedItems}
            />

            <CategorySection
              title={t.trending}
              description={
                language === "fr"
                  ? `Les annonces qui attirent le plus d'attention en ce moment dans ${categoryTitleLower}.`
                  : `Listings gaining attention right now in ${categoryTitleLower}.`
              }
              items={trendingItems}
            />

            <CategorySection
              title={t.recentlyAdded}
              description={
                language === "fr"
                  ? `Les annonces les plus récentes dans ${categoryTitleLower}.`
                  : `Newest listings in ${categoryTitleLower}.`
              }
              items={recentlyAddedItems}
            />

            <CategorySection
              title={t.allListingsTitle}
              description={
                language === "fr"
                  ? "Toutes les annonces actuellement affichées dans cette catégorie."
                  : "Every listing currently shown in this category."
              }
              items={allAvailablePreview}
              href={`/categories/${resolvedParams.slug}/all`}
            />
          </>
        ) : (
          <section className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 dark:bg-muted/40 dark:ring-border md:p-8">
            <h2 className="text-2xl font-bold text-zinc-950 dark:text-foreground">{t.noActiveListingsYetTitle}</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-muted-foreground">
              {language === "fr"
                ? `Aucune annonce active n'est disponible dans ${categoryTitleLower} pour le moment. Revenez bientôt ou explorez une autre catégorie.`
                : `There are no active listings in ${categoryTitleLower} right now. Check back soon or explore another category.`}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
