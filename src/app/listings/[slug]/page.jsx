import { MessageCircle, Clock3, MapPin, Tag, UserRound } from "lucide-react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardImage } from "@/components/card-image";
import { FavouriteButton } from "@/components/favourite-button";
import { ListingPhotoCarousel } from "@/components/listing-photo-carousel";
import { createClient } from "@/utils/supabase/server";

function formatDate(dateString) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateString));
}

function formatPrice(price) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Number(price ?? 0));
}

function isNewListing(createdAt) {
  const createdTime = new Date(createdAt).getTime();
  const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - createdTime <= sevenDaysInMs;
}

function getListingBadge(listing) {
  if (listing.status === "sold") {
    return "Sold";
  }

  if (listing.is_featured) {
    return "Featured";
  }

  if (
    listing.previous_price !== null &&
    listing.previous_price !== undefined &&
    Number(listing.previous_price) > Number(listing.price ?? 0)
  ) {
    return "Price Drop";
  }

  if (listing.is_negotiable) {
    return "Negotiable";
  }

  if (listing.created_at && isNewListing(listing.created_at)) {
    return "New";
  }

  return "Listing";
}

export default async function ListingDetailPage({ params }) {
  const resolvedParams = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select(
      "id, seller_id, slug, title, description, price, category, condition, location, status, created_at, updated_at, previous_price, is_featured, is_negotiable"
    )
    .eq("slug", resolvedParams.slug)
    .single();

  if (listingError || !listing) {
    notFound();
  }

  const [{ data: listingImages = [] }, { data: seller }, { data: favourite }] = await Promise.all([
    supabase
      .from("listing_images")
      .select("image_url, storage_path, position, created_at")
      .eq("listing_id", listing.id)
      .order("position", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, first_name, last_name, school")
      .eq("id", listing.seller_id)
      .single(),
    user
      ? supabase
          .from("listing_favourites")
          .select("listing_id")
          .eq("user_id", user.id)
          .eq("listing_id", listing.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: similarRows = [] } = await supabase
    .from("listings")
    .select(
      `id,
      seller_id,
      slug,
      title,
      price,
      category,
      location,
      status,
      created_at,
      previous_price,
      is_featured,
      is_negotiable,
      listing_images (
        image_url,
        position
      )`
    )
    .eq("category", listing.category)
    .eq("status", "active")
    .neq("slug", listing.slug)
    .limit(5);

  const similarSellerIds = [
    ...new Set(similarRows.map((item) => item.seller_id).filter(Boolean)),
  ];

  const { data: similarProfiles = [] } = similarSellerIds.length
    ? await supabase
        .from("profiles")
        .select("id, school")
        .in("id", similarSellerIds)
    : { data: [] };

  const schoolBySellerId = new Map(
    similarProfiles.map((profile) => [profile.id, profile.school])
  );

  const sellerName =
    [seller?.first_name, seller?.last_name].filter(Boolean).join(" ").trim() ||
    "Student Seller";

  const initials = sellerName
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "SM";

  const photos = listingImages.length
    ? listingImages.map((image, index) => ({
        label: `Photo ${index + 1}`,
        imageUrl: image.image_url,
        storagePath: image.storage_path,
      }))
    : [{ label: "Photo 1" }];

  const campusLabel = listing.location || seller?.school || "Toronto meetup";
  const badge = getListingBadge(listing);
  const initialIsFavourited = Boolean(favourite);
  const similarListings = similarRows.map((item) => ({
    slug: item.slug,
    title: item.title,
    price: formatPrice(item.price),
    meta: schoolBySellerId.get(item.seller_id) || item.location || "Toronto meetup",
    badge: getListingBadge(item),
    imageUrl: (item.listing_images ?? [])
      .slice()
      .sort((firstImage, secondImage) => firstImage.position - secondImage.position)[0]
      ?.image_url,
  }));

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
            <div className="flex flex-col gap-5">
              <ListingPhotoCarousel photos={photos} title={listing.title} />

              <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-none">
                <CardHeader className="border-b border-zinc-200 px-6 py-5 md:px-7">
                  <CardTitle className="text-2xl text-zinc-950">Description</CardTitle>
                </CardHeader>
                <CardContent className="px-6 py-6 text-base leading-8 text-zinc-600 md:px-7">
                  {listing.description}
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-5">
              <Card className="rounded-[2rem] border-zinc-200 bg-zinc-50 py-0 shadow-none">
                <CardContent className="space-y-6 p-6 md:p-7">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-3">
                      <Badge variant="outline" className="w-fit border-zinc-300 bg-white text-zinc-700">
                        {badge}
                      </Badge>
                      <div className="space-y-2">
                        <h1 className="text-3xl font-bold tracking-tight text-zinc-950 md:text-4xl">
                          {listing.title}
                        </h1>
                        <p className="text-3xl font-bold text-zinc-900">{formatPrice(listing.price)}</p>
                      </div>
                    </div>

                    <FavouriteButton
                      listingId={listing.id}
                      initialIsFavourited={initialIsFavourited}
                    />
                  </div>

                    <div className="grid gap-3 text-sm text-zinc-600 sm:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                        Campus
                      </p>
                      <p className="mt-2 text-base font-medium text-zinc-900">
                        {campusLabel}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                        Condition
                      </p>
                      <p className="mt-2 text-base font-medium text-zinc-900">
                        {listing.condition}
                      </p>
                    </div>
                  </div>

                  <Button type="button" className="w-full sm:w-auto">
                    <MessageCircle className="size-4" />
                    <span>Chat with Seller</span>
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-none">
                <CardContent className="space-y-5 p-6 md:p-7">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14 rounded-2xl">
                      <AvatarFallback className="rounded-2xl bg-zinc-200 text-zinc-900">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-xl font-semibold text-zinc-950">
                        {sellerName}
                      </p>
                      <p className="text-sm text-zinc-500">{seller?.school || "Toronto student"}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm text-zinc-600 sm:grid-cols-2">
                    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <Clock3 className="size-4 text-zinc-500" />
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                          Created
                        </p>
                        <p className="mt-1 text-zinc-900">{formatDate(listing.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <Tag className="size-4 text-zinc-500" />
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                          Updated
                        </p>
                        <p className="mt-1 text-zinc-900">{formatDate(listing.updated_at)}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
          <div className="mb-5 flex items-center gap-3">
            <MapPin className="size-5 text-zinc-500" />
            <div>
              <h2 className="text-2xl font-bold text-zinc-950">Meetup Location</h2>
              <p className="text-sm text-zinc-500">
                Campus meetup spot based on the listing location.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-zinc-100">
            <iframe
              title={`${campusLabel} map`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(
                campusLabel
              )}&z=15&output=embed`}
              className="h-[360px] w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </section>

        <section className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-zinc-950">Similar Listings</h2>
              <p className="mt-1 text-sm text-zinc-500">
                More options from the same category.
              </p>
            </div>
            <div className="hidden items-center gap-2 text-sm font-medium text-zinc-500 md:flex">
              <UserRound className="size-4" />
              <span>Student marketplace picks</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {similarListings.map((item) => (
              <CardImage
                key={item.slug}
                badge={item.badge}
                title={item.title}
                price={item.price}
                meta={item.meta}
                imageUrl={item.imageUrl}
                href={`/listings/${item.slug}`}
                imageAlt={item.title}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
