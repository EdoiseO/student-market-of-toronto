import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";
import { CATEGORIES, getCategoryValuesBySlug } from "@/lib/categories";
import HomePageContent from "@/components/home-page-content";

const NEW_LISTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HOME_SECTION_LIMIT = 6;

function getListingBadge(listing) {
  if (listing.is_featured) {
    return "Featured";
  }

  const createdAt = new Date(listing.created_at).getTime();

  if (
    !Number.isNaN(createdAt) &&
    Date.now() - createdAt <= NEW_LISTING_WINDOW_MS
  ) {
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
      (a, b) => a.position - b.position
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

  const sectionsWithBadges = listingSections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      badge: getListingBadge(item),
    })),
  }));

  return <HomePageContent listingSections={sectionsWithBadges} />;
}