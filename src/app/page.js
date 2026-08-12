import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";
import { CATEGORIES, getCategoryValuesBySlug } from "@/lib/categories";
import HomePageContent from "@/components/home-page-content";
import { getListingBadgeKey } from "@/lib/listing-badges";

const HOME_SECTION_LIMIT = 6;

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
      previous_price,
      category,
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
      badge: getListingBadgeKey(item),
    })),
  }));

  return <HomePageContent listingSections={sectionsWithBadges} />;
}
