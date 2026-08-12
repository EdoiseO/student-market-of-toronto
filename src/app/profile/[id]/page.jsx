import { Clock3, ListIcon } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CollapsibleProfileBio } from "@/components/collapsible-profile-bio";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ProfileListingsSection } from "@/components/profile-listings-section";
import { ProfileReportButton } from "@/components/profile-report-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getListingBadgeKey } from "@/lib/listing-badges";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

function formatDate(dateString, language) {
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateString));
}

function formatShortDate(dateString, language) {
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    year: "numeric",
  }).format(new Date(dateString));
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
      category,
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
    badge: getListingBadgeKey(listing),
    listing_images: [...(listing.listing_images ?? [])].sort(
      (firstImage, secondImage) => (firstImage.position ?? 0) - (secondImage.position ?? 0),
    ),
  }));

  return (
    <main className="min-h-screen bg-zinc-100 p-4 dark:bg-background md:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 md:gap-6 lg:gap-7">
        <section className="rounded-[1.5rem] bg-white p-3 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border sm:p-6 lg:rounded-3xl lg:p-7">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 lg:grid-cols-[auto_minmax(0,1fr)_minmax(420px,456px)] lg:gap-x-6">
            <div className="shrink-0">
              <ProfileAvatar
                email={null}
                name={sellerName}
                avatarPresetId={profile.avatar_preset_id ?? null}
                avatarUrl={profile.avatar_url ?? null}
                className="size-16 max-h-none max-w-none rounded-2xl after:rounded-2xl sm:size-28 sm:rounded-3xl sm:after:rounded-3xl"
                imageClassName="rounded-2xl sm:rounded-3xl"
                imageSizes="(max-width: 639px) 64px, 112px"
                fallbackClassName="rounded-2xl sm:rounded-3xl"
              />
            </div>

            <div className="min-w-0 self-center">
              <Badge variant="outline" className="mb-1 h-4 min-h-0 border-zinc-300 bg-zinc-50 px-1.5 text-xs leading-none text-zinc-700 dark:border-border dark:bg-muted dark:text-foreground sm:mb-2 sm:h-auto sm:px-2">
                {t.seller}
              </Badge>
              <h1 className="truncate text-lg font-bold leading-5 tracking-tight text-zinc-950 dark:text-foreground sm:text-3xl sm:leading-normal lg:text-4xl">
                {sellerName}
              </h1>
              <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-muted-foreground sm:mt-2 sm:text-base">
                {profile.school || t.torontoStudent}
              </p>
            </div>

            <div className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:gap-3">
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 lg:gap-3">
                <div className="flex min-w-0 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-2 dark:border-border dark:bg-muted/40 sm:rounded-2xl sm:p-4 lg:gap-3">
                  <ListIcon className="size-3.5 shrink-0 text-zinc-500 dark:text-muted-foreground sm:size-4" />
                  <div className="min-w-0">
                    <p className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-muted-foreground sm:tracking-[0.16em]">
                      <span className="sm:hidden">{t.profileListingsStatLabel}</span>
                      <span className="hidden sm:inline">{t.activeListingsTitle}</span>
                    </p>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-foreground sm:mt-1 sm:text-base sm:font-normal">
                      {sellerListings.length}
                    </p>
                  </div>
                </div>

                <div className="flex min-w-0 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-2 dark:border-border dark:bg-muted/40 sm:rounded-2xl sm:p-4 lg:gap-3">
                  <Clock3 className="size-3.5 shrink-0 text-zinc-500 dark:text-muted-foreground sm:size-4" />
                  <div className="min-w-0">
                    <p className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-muted-foreground sm:tracking-[0.16em]">
                      <span className="sm:hidden">{t.profileJoinedStatLabel}</span>
                      <span className="hidden sm:inline">{t.memberSince}</span>
                    </p>
                    <p className="whitespace-nowrap text-xs font-medium text-zinc-900 dark:text-foreground sm:mt-1 sm:text-base sm:font-normal">
                      {profile.created_at ? (
                        <>
                          <span className="sm:hidden">{formatShortDate(profile.created_at, language)}</span>
                          <span className="hidden sm:inline">{formatDate(profile.created_at, language)}</span>
                        </>
                      ) : "—"}
                    </p>
                  </div>
                </div>
              </div>

              <ProfileReportButton profileId={profile.id} currentUserId={user.id} />
            </div>
          </div>

          <div className="mt-3 w-full max-w-5xl rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-border dark:bg-muted/40 sm:mt-5 sm:rounded-2xl sm:p-5 lg:p-6">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-muted-foreground sm:mb-3 sm:text-sm sm:tracking-[0.16em]">
              {t.profileDescriptionTitle}
            </p>
            {profile.bio ? (
              <CollapsibleProfileBio bio={profile.bio} />
            ) : (
              <p className="text-xs leading-5 text-zinc-500 dark:text-muted-foreground sm:text-base">{t.profileNoBio}</p>
            )}
          </div>
        </section>

        <section className="rounded-[1.5rem] bg-white p-3 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border sm:rounded-3xl sm:p-6 lg:p-7">
          {sellerListings.length > 0 ? (
            <ProfileListingsSection listings={sellerListings} sellerSchool={profile.school || ""} />
          ) : (
            <Card className="rounded-3xl border-zinc-200 bg-zinc-50 py-0 shadow-none dark:bg-muted/40 dark:ring-border">
              <CardHeader className="px-6 py-6">
                <CardTitle className="text-xl text-zinc-950 dark:text-foreground">{t.noActiveListingsTitle}</CardTitle>
                <CardDescription>{t.noActiveListingsDescription}</CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <Link href="/" className="text-sm font-medium text-zinc-900 underline underline-offset-4 dark:text-foreground">
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
