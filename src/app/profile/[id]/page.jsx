import { Clock3, ListIcon, UserRound } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CardImage } from "@/components/card-image";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export default async function PublicProfilePage({ params }) {
  const resolvedParams = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language];

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, school, avatar_preset_id, avatar_url, bio, is_public, created_at")
    .eq("id", resolvedParams.id)
    .maybeSingle();

  if (profileError) {
    console.error("Failed to load seller profile:", profileError.message);
  }

  if (!profile) {
    notFound();
  }

  const { data: listingRows, error: listingsError } = await supabase
    .from("listings")
    .select(`
      id,
      slug,
      title,
      price,
      location,
      status,
      created_at,
      is_featured,
      previous_price,
      is_negotiable,
      listing_images (
        image_url,
        position
      )
    `)
    .eq("seller_id", profile.id)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (listingsError) {
    console.error("Failed to load seller listings:", listingsError.message);
  }

  const sellerName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || t.studentSeller;

  const sellerListings = (listingRows ?? []).map((listing) => ({
    ...listing,
    listing_images: [...(listing.listing_images ?? [])].sort(
      (firstImage, secondImage) => (firstImage.position ?? 0) - (secondImage.position ?? 0),
    ),
  }));

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-start gap-5">
              <ProfileAvatar
                email={null}
                name={sellerName}
                avatarPresetId={profile.avatar_preset_id ?? null}
                avatarUrl={profile.avatar_url ?? null}
                className="h-20 w-20 rounded-3xl"
                fallbackClassName="rounded-3xl"
              />

              <div className="space-y-3">
                <div className="space-y-2">
                  <Badge variant="outline" className="border-zinc-300 bg-zinc-50 text-zinc-700">
                    {t.seller}
                  </Badge>
                  <h1 className="text-4xl font-bold tracking-tight text-zinc-950">{sellerName}</h1>
                  <p className="text-base text-zinc-600">{profile.school || t.torontoStudent}</p>
                </div>

                {profile.bio ? (
                  <p className="max-w-3xl whitespace-pre-line text-base leading-7 text-zinc-600">
                    {profile.bio}
                  </p>
                ) : (
                  <p className="max-w-3xl text-base text-zinc-500">{t.profileNoBio}</p>
                )}
              </div>
            </div>

            <div className="grid min-w-[260px] gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <ListIcon className="size-4 text-zinc-500" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    {t.activeListingsTitle}
                  </p>
                  <p className="mt-1 text-zinc-900">{sellerListings.length}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <Clock3 className="size-4 text-zinc-500" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    {t.memberSince}
                  </p>
                  <p className="mt-1 text-zinc-900">
                    {profile.created_at ? formatDate(profile.created_at, language) : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200 md:p-8">
          <div className="mb-5 flex items-center gap-3">
            <UserRound className="size-5 text-zinc-500" />
            <div>
              <h2 className="text-2xl font-bold text-zinc-950">{t.activeListingsTitle}</h2>
              <p className="text-sm text-zinc-500">{t.activeListingsDescription}</p>
            </div>
          </div>

          {sellerListings.length > 0 ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              {sellerListings.map((listing) => (
                <CardImage
                  key={listing.id}
                  badge={getListingBadge(listing, t)}
                  title={listing.title}
                  price={formatPrice(listing.price, language)}
                  meta={listing.location || profile.school || t.torontoMeetup}
                  imageUrls={(listing.listing_images ?? []).map((image) => image.image_url)}
                  imageUrl={listing.listing_images?.[0]?.image_url ?? null}
                  href={`/listings/${listing.slug}`}
                  imageAlt={listing.title}
                />
              ))}
            </div>
          ) : (
            <Card className="rounded-3xl border-zinc-200 bg-zinc-50 py-0 shadow-none">
              <CardHeader className="px-6 py-6">
                <CardTitle className="text-xl text-zinc-950">{t.noActiveListingsTitle}</CardTitle>
                <CardDescription>{t.noActiveListingsDescription}</CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <Link href="/" className="text-sm font-medium text-zinc-900 underline underline-offset-4">
                  {t.browseListings}
                </Link>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
