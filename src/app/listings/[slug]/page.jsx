import { MessageCircle, Clock3, MapPin, Tag, UserRound } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

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
import { ProfileAvatar } from "@/components/profile-avatar";
import { getTranslatedConditionLabel } from "@/lib/search-listings";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

function formatDate(dateString, language) {
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateString));
}

function formatPrice(price, language) {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
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

function getListingBadge(listing, t) {
  if (listing.status === "sold") {
    return t.sold;
  }

  if (listing.is_featured) {
    return t.featured;
  }

  if (
    listing.previous_price !== null &&
    listing.previous_price !== undefined &&
    Number(listing.previous_price) > Number(listing.price ?? 0)
  ) {
    return t.priceDrop;
  }

  if (listing.is_negotiable) {
    return t.negotiable;
  }

  if (listing.created_at && isNewListing(listing.created_at)) {
    return t.new;
  }

  return t.listing;
}

export default async function ListingDetailPage({ params }) {
  const resolvedParams = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language];

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

  const [listingImagesResult, sellerResult, favouriteResult] = await Promise.all([
    supabase
      .from("listing_images")
      .select("image_url, storage_path, position, created_at")
      .eq("listing_id", listing.id)
      .order("position", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, first_name, last_name, school, avatar_preset_id, avatar_url, bio, is_public")
      .eq("id", listing.seller_id)
      .maybeSingle(),
    user
      ? supabase
          .from("listing_favourites")
          .select("listing_id")
          .eq("user_id", user.id)
          .eq("listing_id", listing.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const listingImages = listingImagesResult.data ?? [];
  const seller = sellerResult.data ?? null;
  const favourite = favouriteResult.data ?? null;

  const similarRowsResult = await supabase
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

  const similarRows = similarRowsResult.data ?? [];

  const similarSellerIds = [
    ...new Set(similarRows.map((item) => item.seller_id).filter(Boolean)),
  ];

  const similarProfilesResult = similarSellerIds.length
    ? await supabase
        .from("profiles")
        .select("id, school")
        .in("id", similarSellerIds)
    : { data: [] };

  const similarProfiles = similarProfilesResult.data ?? [];

  const schoolBySellerId = new Map(
    similarProfiles.map((profile) => [profile.id, profile.school])
  );

  const sellerName =
    [seller?.first_name, seller?.last_name].filter(Boolean).join(" ").trim() ||
    t.studentSeller;

  const photos = listingImages.length
    ? listingImages.map((image, index) => ({
        label: `${t.photo} ${index + 1}`,
        imageUrl: image.image_url,
        storagePath: image.storage_path,
      }))
    : [{ label: `${t.photo} 1` }];

  const campusLabel = listing.location || seller?.school || t.torontoMeetup;
  const badge = getListingBadge(listing, t);
  const initialIsFavourited = Boolean(favourite);

  const similarListings = similarRows.map((item) => ({
    slug: item.slug,
    title: item.title,
    price: formatPrice(item.price, language),
    meta:
      schoolBySellerId.get(item.seller_id) || item.location || t.torontoMeetup,
    badge: getListingBadge(item, t),
    imageUrls: (item.listing_images ?? [])
      .slice()
      .sort(
        (firstImage, secondImage) =>
          firstImage.position - secondImage.position
      )
      .map((image) => image.image_url),
    imageUrl: (item.listing_images ?? [])
      .slice()
      .sort(
        (firstImage, secondImage) =>
          firstImage.position - secondImage.position
      )[0]?.image_url,
  }));

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.45fr)_minmax(256px,0.95fr)]">
            <div className="flex flex-col gap-5">
              <ListingPhotoCarousel photos={photos} title={listing.title} />

              <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-none">
                <CardHeader className="border-b border-zinc-200 px-6 py-5 md:px-7">
                  <CardTitle className="text-2xl text-zinc-950">
                    {t.description}
                  </CardTitle>
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
                      <Badge
                        variant="outline"
                        className="w-fit border-zinc-300 bg-white text-zinc-700"
                      >
                        {badge}
                      </Badge>
                      <div className="space-y-2">
                        <h1 className="text-3xl font-bold tracking-tight text-zinc-950 md:text-4xl">
                          {listing.title}
                        </h1>
                        <p className="text-3xl font-bold text-zinc-900">
                          {formatPrice(listing.price, language)}
                        </p>
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
                        {t.campus}
                      </p>
                      <p className="mt-2 text-base font-medium text-zinc-900">
                        {campusLabel}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                        {t.condition}
                      </p>
                      <p className="mt-2 text-base font-medium text-zinc-900">
                        {getTranslatedConditionLabel(listing.condition, t)}
                      </p>
                    </div>
                  </div>

                  <Button type="button" className="w-full sm:w-auto">
                    <MessageCircle className="size-4" />
                    <span>{t.chatWithSeller}</span>
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-none">
                <CardContent className="space-y-5 p-6 md:p-7">
                  {seller?.id ? (
                    <Link
                      href={`/profile/${seller.id}`}
                      className="flex w-full items-center gap-4 rounded-2xl transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15 sm:w-fit"
                    >
                      <ProfileAvatar
                        email={null}
                        name={sellerName}
                        avatarPresetId={seller?.avatar_preset_id ?? null}
                        avatarUrl={seller?.avatar_url ?? null}
                        className="h-14 w-14 rounded-2xl"
                        fallbackClassName="rounded-2xl"
                      />
                      <div>
                        <p className="text-xl font-semibold text-zinc-950">
                          {sellerName}
                        </p>
                        <p className="text-sm text-zinc-500">
                          {seller?.school || t.torontoStudent}
                        </p>
                      </div>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-4">
                      <ProfileAvatar
                        email={null}
                        name={sellerName}
                        avatarPresetId={seller?.avatar_preset_id ?? null}
                        avatarUrl={seller?.avatar_url ?? null}
                        className="h-14 w-14 rounded-2xl"
                        fallbackClassName="rounded-2xl"
                      />
                      <div>
                        <p className="text-xl font-semibold text-zinc-950">
                          {sellerName}
                        </p>
                        <p className="text-sm text-zinc-500">
                          {seller?.school || t.torontoStudent}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 text-sm text-zinc-600 sm:grid-cols-2">
                    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <Clock3 className="size-4 text-zinc-500" />
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                          {t.created}
                        </p>
                        <p className="mt-1 text-zinc-900">
                          {formatDate(listing.created_at, language)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <Tag className="size-4 text-zinc-500" />
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                          {t.updated}
                        </p>
                        <p className="mt-1 text-zinc-900">
                          {formatDate(listing.updated_at, language)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {seller?.bio && !seller?.is_public ? (
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        {t.aboutSeller}
                      </p>
                      <p className="mt-2 whitespace-pre-line text-sm leading-7 text-zinc-600">
                        {seller.bio}
                      </p>
                    </div>
                  ) : null}

                  {seller?.id ? (
                    <Button asChild type="button" variant="outline" className="w-full">
                      <Link href={`/profile/${seller.id}`}>{t.viewProfile}</Link>
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
          <div className="mb-5 flex items-center gap-3">
            <MapPin className="size-5 text-zinc-500" />
            <div>
              <h2 className="text-2xl font-bold text-zinc-950">
                {t.meetupLocation}
              </h2>
              <p className="text-sm text-zinc-500">{t.meetupLocationDesc}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-zinc-100">
            <iframe
              title={`${campusLabel} map`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(
                campusLabel
              )}&z=15&output=embed`}
              className="h-[288px] w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </section>

        <section className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-zinc-950">
                {t.similarListings}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {t.similarListingsDesc}
              </p>
            </div>
            <div className="hidden items-center gap-2 text-sm font-medium text-zinc-500 md:flex">
              <UserRound className="size-4" />
              <span>{t.marketplacePicks}</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            {similarListings.map((item) => (
              <CardImage
                key={item.slug}
                badge={item.badge}
                title={item.title}
                price={item.price}
                meta={item.meta}
                imageUrls={item.imageUrls}
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
