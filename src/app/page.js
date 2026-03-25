import Link from "next/link";
import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";
import { CardImage } from "@/components/card-image";
import { CATEGORIES, getCategoryValuesBySlug } from "@/lib/categories";

const NEW_LISTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HOME_SECTION_LIMIT = 6;

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

export default async function Page() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: listings } = await supabase
    .from("listings")
    .select(`
      id,
      slug,
      title,
      price,
      category,
      location,
      is_featured,
      created_at,
      listing_images (
        image_url,
        position
      )
    `)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const normalizedListings = (listings ?? []).map((listing) => ({
    ...listing,
    listing_images: (listing.listing_images ?? []).sort(
      (firstImage, secondImage) => firstImage.position - secondImage.position
    ),
  }));

  const listingSections = CATEGORIES.map((section) => ({
    ...section,
    href: `/categories/${section.slug}`,
    items: normalizedListings
      .filter((listing) =>
        getCategoryValuesBySlug(section.slug).includes(listing.category)
      )
      .slice(0, HOME_SECTION_LIMIT),
  }));

  return (
    <main className="min-h-screen bg-zinc-100 p-6 dark:bg-zinc-950 md:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Student Market of Toronto
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Buy, sell, and discover what Toronto students actually need.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-zinc-600 dark:text-zinc-300">
            Browse featured categories, spot trending deals, and start shaping
            the marketplace flow one page at a time.
          </p>
        </section>

        {listingSections.map((section) => (
          <section
            key={section.title}
            id={section.slug}
            className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900/60 dark:ring-zinc-800"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <Link
                  href={section.href}
                  className="inline-flex items-center gap-2 text-2xl font-bold text-zinc-950 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
                >
                  <span>{section.title}</span>
                  <span aria-hidden="true">➔</span>
                </Link>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Browse featured student listings in this category.
                </p>
              </div>
            </div>

            {section.items.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
                {section.items.map((item) => (
                  <CardImage
                    key={item.id}
                    badge={getListingBadge(item)}
                    title={item.title}
                    price={`$${Number(item.price).toFixed(2)}`}
                    meta={item.location ?? ""}
                    imageUrls={(item.listing_images ?? []).map((image) => image.image_url)}
                    imageUrl={item.listing_images?.[0]?.image_url ?? null}
                    imageAlt={item.title}
                    href={`/listings/${item.slug}`}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No listings available in this category yet.
              </p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
