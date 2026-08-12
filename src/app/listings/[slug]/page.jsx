import { Clock3, MapPin, Tag } from "lucide-react";
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
import { CollapsibleListingDescription } from "@/components/collapsible-listing-description";
import { FavouriteButton } from "@/components/favourite-button";
import { ListingPhotoCarousel } from "@/components/listing-photo-carousel";
import { ListingMoreButton } from "@/components/listing-more-button";
import { ProfileAvatar } from "@/components/profile-avatar";
import { SimilarListingsCarousel } from "@/components/similar-listings-carousel";
import { StartConversationButton } from "@/components/start-conversation-button";
import {
  getListingBadgeKey,
  getTranslatedListingBadge,
} from "@/lib/listing-badges";
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
      .select("image_url, position")
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
    .limit(12);

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
        }))
    : [{ label: `${t.photo} 1` }];

  const campusLabel = listing.location || seller?.school || t.torontoMeetup;
  const badge = getTranslatedListingBadge(
    getListingBadgeKey(listing, { includeFallback: true }),
    t,
  );
  const initialIsFavourited = Boolean(favourite);

  const similarListings = similarRows.map((item) => ({
    slug: item.slug,
    title: item.title,
    price: formatPrice(item.price, language),
    meta:
      schoolBySellerId.get(item.seller_id) || item.location || t.torontoMeetup,
    badge: getListingBadgeKey(item),
    imageUrls: (item.listing_images ?? [])
      .slice()
      .sort(
        (firstImage, secondImage) =>
          firstImage.position - secondImage.position
      )
      .map((image) => image.image_url),
  }));

  return (
    <main className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 pt-4 pb-28 dark:bg-background md:p-8">
      <div className="mx-auto flex min-w-0 w-full max-w-[1440px] flex-col gap-4 md:gap-8">
        <section className="rounded-3xl bg-white p-3 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border md:p-8">
          <div className="grid gap-5 md:gap-8 xl:grid-cols-[minmax(0,1.45fr)_minmax(256px,0.95fr)]">
            <div className="contents xl:flex xl:flex-col xl:gap-5">
              <div className="order-1 min-w-0 xl:order-none">
                <ListingPhotoCarousel photos={photos} title={listing.title} />
              </div>

              <Card className="order-4 rounded-2xl border-zinc-200 bg-white py-0 shadow-none dark:bg-card dark:ring-border md:rounded-[2rem] xl:order-none">
                <CardHeader className="border-b border-zinc-200 px-4 py-3 dark:border-border md:px-7 md:py-5">
                  <CardTitle className="text-lg text-zinc-950 dark:text-foreground md:text-2xl">
                    {t.description}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 py-4 md:px-7 md:py-6">
                  <CollapsibleListingDescription description={listing.description} />
                </CardContent>
              </Card>
            </div>

            <div className="contents xl:flex xl:flex-col xl:gap-5">
              <Card className="order-2 rounded-2xl border-zinc-200 bg-zinc-50 py-0 shadow-none dark:bg-muted/40 dark:ring-border md:rounded-[2rem] xl:order-none">
                <CardContent className="space-y-4 p-4 md:space-y-6 md:p-7">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 md:space-y-3">
                      <Badge
                        variant="outline"
                        className="w-fit border-zinc-300 bg-white text-[10px] text-zinc-700 dark:border-border dark:bg-background dark:text-foreground md:text-xs"
                      >
                        {badge}
                      </Badge>
                      <div className="space-y-1.5 md:space-y-2">
                        <h1 className="text-2xl font-bold leading-tight tracking-tight text-zinc-950 dark:text-foreground md:text-4xl md:leading-normal">
                          {listing.title}
                        </h1>
                        <p className="text-2xl font-bold text-zinc-900 dark:text-foreground md:text-3xl">
                          {formatPrice(listing.price, language)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="hidden md:block">
                        <FavouriteButton
                          listingId={listing.id}
                          initialIsFavourited={initialIsFavourited}
                        />
                      </div>
                      <ListingMoreButton
                        slug={listing.slug}
                        listingId={listing.id}
                        currentUserId={user?.id ?? null}
                        sellerId={listing.seller_id}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm text-zinc-600 dark:text-muted-foreground md:gap-3">
                    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-border dark:bg-background md:rounded-2xl md:p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-muted-foreground md:text-xs md:tracking-[0.2em]">
                        {t.campus}
                      </p>
                      <p className="mt-1.5 text-[12px] font-medium leading-5 text-zinc-900 dark:text-foreground md:mt-2 md:text-base md:leading-normal">
                        {campusLabel}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-border dark:bg-background md:rounded-2xl md:p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-muted-foreground md:text-xs md:tracking-[0.2em]">
                        {t.condition}
                      </p>
                      <p className="mt-1.5 text-[12px] font-medium leading-5 text-zinc-900 dark:text-foreground md:mt-2 md:text-base md:leading-normal">
                        {getTranslatedConditionLabel(listing.condition, t)}
                      </p>
                    </div>
                  </div>

                  <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none">
                    <div className="md:hidden">
                      <FavouriteButton
                        listingId={listing.id}
                        initialIsFavourited={initialIsFavourited}
                      />
                    </div>
                    <StartConversationButton
                      listingId={listing.id}
                      listingTitle={listing.title}
                      listingStatus={listing.status}
                      sellerId={listing.seller_id}
                      currentUserId={user?.id ?? null}
                      className="min-h-12 min-w-0 flex-1 md:flex-none"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="order-3 rounded-2xl border-zinc-200 bg-white py-0 shadow-none dark:bg-card dark:ring-border md:rounded-[2rem] xl:order-none">
                <CardContent className="space-y-4 p-4 md:space-y-5 md:p-7">
                  {seller?.id ? (
                    <Link
                      href={`/profile/${seller.id}`}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15 dark:focus-visible:ring-white/15 sm:w-fit md:gap-4 md:rounded-2xl"
                    >
                      <ProfileAvatar
                        email={null}
                        name={sellerName}
                        avatarPresetId={seller?.avatar_preset_id ?? null}
                        avatarUrl={seller?.avatar_url ?? null}
                        className="h-12 w-12 rounded-xl md:h-14 md:w-14 md:rounded-2xl"
                        fallbackClassName="rounded-xl md:rounded-2xl"
                      />
                      <div>
                        <p className="text-base font-semibold leading-tight text-zinc-950 dark:text-foreground md:text-xl md:leading-normal">
                          {sellerName}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-muted-foreground md:mt-0 md:text-sm md:leading-normal">
                          {seller?.school || t.torontoStudent}
                        </p>
                      </div>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 md:gap-4">
                      <ProfileAvatar
                        email={null}
                        name={sellerName}
                        avatarPresetId={seller?.avatar_preset_id ?? null}
                        avatarUrl={seller?.avatar_url ?? null}
                        className="h-12 w-12 rounded-xl md:h-14 md:w-14 md:rounded-2xl"
                        fallbackClassName="rounded-xl md:rounded-2xl"
                      />
                      <div>
                        <p className="text-base font-semibold leading-tight text-zinc-950 dark:text-foreground md:text-xl md:leading-normal">
                          {sellerName}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-muted-foreground md:mt-0 md:text-sm md:leading-normal">
                          {seller?.school || t.torontoStudent}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-zinc-600 dark:text-muted-foreground md:gap-3">
                    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-border dark:bg-muted/40 md:gap-3 md:rounded-2xl md:p-4">
                      <Clock3 className="size-3.5 shrink-0 text-zinc-500 dark:text-muted-foreground md:size-4" />
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-muted-foreground md:text-xs md:tracking-[0.16em]">
                          {t.created}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-zinc-900 dark:text-foreground md:mt-1 md:text-sm md:leading-normal">
                          {formatDate(listing.created_at, language)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-border dark:bg-muted/40 md:gap-3 md:rounded-2xl md:p-4">
                      <Tag className="size-3.5 shrink-0 text-zinc-500 dark:text-muted-foreground md:size-4" />
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-muted-foreground md:text-xs md:tracking-[0.16em]">
                          {t.updated}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-zinc-900 dark:text-foreground md:mt-1 md:text-sm md:leading-normal">
                          {formatDate(listing.updated_at, language)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {seller?.bio && !seller?.is_public ? (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-border dark:bg-muted/40 md:rounded-2xl md:p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-muted-foreground md:text-xs md:tracking-[0.16em]">
                        {t.aboutSeller}
                      </p>
                      <p className="mt-1.5 whitespace-pre-line text-xs leading-5 text-zinc-600 dark:text-muted-foreground md:mt-2 md:text-sm md:leading-7">
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

        <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border md:p-8">
          <div className="mb-3 flex items-center gap-2 md:mb-5 md:gap-3">
            <MapPin className="size-4 text-zinc-500 dark:text-muted-foreground md:size-5" />
            <div>
              <h2 className="text-lg font-bold text-zinc-950 dark:text-foreground md:text-2xl">
                {t.meetupLocation}
              </h2>
              <p className="text-xs leading-5 text-zinc-500 dark:text-muted-foreground md:text-sm md:leading-normal">{t.meetupLocationDesc}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-muted md:rounded-[2rem]">
            <iframe
              title={`${campusLabel} map`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(
                campusLabel
              )}&z=15&output=embed`}
              className="h-[168px] w-full border-0 min-[430px]:h-[184px] md:h-[288px]"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </section>

        <section className="rounded-3xl bg-zinc-50 p-4 shadow-sm ring-1 ring-zinc-200 dark:bg-muted/40 dark:ring-border md:p-8">
          <SimilarListingsCarousel items={similarListings} />
        </section>
      </div>
    </main>
  );
}
