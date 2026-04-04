import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardTableClient } from "@/components/dashboard-table-client";
import { normalizeCategoryValue } from "@/lib/categories";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const dashboardTabs = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "sold", label: "Sold" },
  { key: "draft", label: "Draft" },
  { key: "favourite", label: "Favourite" },
];

function normalizeDashboardListing(listing, dashboardStatus = listing.status) {
  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    meta: listing.location ?? "",
    imageUrl: getPrimaryImageUrl(listing.listing_images),
    price: `$${Number(listing.price).toFixed(2)}`,
    category: normalizeCategoryValue(listing.category),
    dashboardStatus,
    messageCount: 0,
  };
}

function getPrimaryImageUrl(listingImages) {
  return (listingImages ?? [])
    .slice()
    .sort((firstImage, secondImage) => firstImage.position - secondImage.position)[0]
    ?.image_url;
}

export default async function DashboardPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const requestedTab = resolvedSearchParams?.tab ?? "all";
  const currentTab = dashboardTabs.some((tab) => tab.key === requestedTab)
    ? requestedTab
    : "all";

  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const shouldLoadFavourites = currentTab === "favourite" || requestedTab === "favourite";

  const [
    { data: myListings, error: listingsError },
    { data: favourites, error: favouritesError },
    { count: favouriteCount = 0, error: favouriteCountError },
  ] = await Promise.all([
    (() => {
      let listingsQuery = supabase
      .from("listings")
      .select(`
        id,
        slug,
        title,
        price,
        category,
        status,
        location,
        created_at,
        listing_images (
          image_url,
          position
        )
      `)
      .eq("seller_id", user.id);

      return listingsQuery.order("created_at", { ascending: false });
    })(),
    shouldLoadFavourites
      ? supabase
          .from("listing_favourites")
          .select(`
            listing_id,
            listings (
              id,
              slug,
              title,
              price,
              category,
              status,
              location,
              listing_images (
                image_url,
                position
              )
            )
          `)
          .eq("user_id", user.id)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("listing_favourites")
      .select("listing_id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  if (listingsError || favouritesError || favouriteCountError) {
    console.error("Dashboard query failed", {
      listingsError,
      favouritesError,
      favouriteCountError,
    });
  }

  const ownedItems = (myListings ?? []).map((listing) => normalizeDashboardListing(listing));

  const favouriteItems = shouldLoadFavourites
    ? (favourites ?? [])
    .map((favourite) =>
      Array.isArray(favourite.listings)
        ? favourite.listings[0]
        : favourite.listings,
    )
    .filter(Boolean)
    .map((listing) => normalizeDashboardListing(listing, "favourite"))
    : [];

  return (
    <main className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-7">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6">
        <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
          <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border lg:px-7">
            <CardTitle className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-foreground lg:text-4xl">
              {t.dashboard}
            </CardTitle>
            <p className="max-w-2xl text-base text-zinc-600 dark:text-muted-foreground">
              {t.dashboardDescription}
            </p>
          </CardHeader>

          <CardContent className="space-y-5 p-8 pt-3">
            <DashboardTableClient
              currentTab={currentTab}
              ownedItems={ownedItems}
              favouriteItems={favouriteItems}
              favouriteCount={favouriteCount}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
