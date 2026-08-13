import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";
import { CATEGORIES, getCategoryValuesBySlug } from "@/lib/categories";
import HomePageContent from "@/components/home-page-content";
import { getListingBadgeKey } from "@/lib/listing-badges";

const HOME_SECTION_LIMIT = 6;
const LISTING_IMAGE_LIMIT = 10;

export default async function Page() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const listingSections = await Promise.all(
    CATEGORIES.map(async (section) => {
      const { data: listings, error } = await supabase
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
        .in("category", getCategoryValuesBySlug(section.slug))
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .order("position", { referencedTable: "listing_images", ascending: true })
        .limit(LISTING_IMAGE_LIMIT, { referencedTable: "listing_images" })
        .limit(HOME_SECTION_LIMIT);

      if (error) {
        console.error(`Failed to load home section ${section.slug}:`, error.message);
      }

      return {
        ...section,
        href: `/categories/${section.slug}`,
        items: listings ?? [],
      };
    }),
  );

  const sectionsWithBadges = listingSections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      badge: getListingBadgeKey(item),
    })),
  }));

  return <HomePageContent listingSections={sectionsWithBadges} />;
}
