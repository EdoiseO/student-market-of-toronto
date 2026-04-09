import { Clock3, ListIcon } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ProfileAvatar } from "@/components/profile-avatar";
import { ProfileListingsSection } from "@/components/profile-listings-section";
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
    <main className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 lg:gap-7">
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border sm:p-6 lg:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
            <div className="shrink-0">
              <ProfileAvatar
                email={null}
                name={sellerName}
                avatarPresetId={profile.avatar_preset_id ?? null}
                avatarUrl={profile.avatar_url ?? null}
                className="h-24 w-24 rounded-3xl after:rounded-3xl sm:h-28 sm:w-28 lg:h-32 lg:w-32"
                imageClassName="rounded-3xl"
                fallbackClassName="rounded-3xl"
              />
            </div>

            <div className="flex-1 space-y-4">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <Badge variant="outline" className="border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-border dark:bg-muted dark:text-foreground">
                    {t.seller}
                  </Badge>
                  <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-foreground sm:text-3xl lg:text-4xl">
                    {sellerName}
                  </h1>
                  <p className="text-base text-zinc-600 dark:text-muted-foreground">{profile.school || t.torontoStudent}</p>
                </div>

                <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:max-w-[304px]">
                  <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-border dark:bg-muted/40">
                    <ListIcon className="size-4 text-zinc-500 dark:text-muted-foreground" />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-muted-foreground">
                        {t.activeListingsTitle}
                      </p>
                      <p className="mt-1 text-zinc-900 dark:text-foreground">{sellerListings.length}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-border dark:bg-muted/40">
                    <Clock3 className="size-4 text-zinc-500 dark:text-muted-foreground" />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-muted-foreground">
                        {t.memberSince}
                      </p>
                      <p className="mt-1 text-zinc-900 dark:text-foreground">
                        {profile.created_at ? formatDate(profile.created_at, language) : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 w-full max-w-5xl rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-border dark:bg-muted/40 sm:p-5 lg:p-6">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-muted-foreground">
              {t.profileDescriptionTitle}
            </p>
            {profile.bio ? (
              <p className="whitespace-pre-line text-base leading-7 text-zinc-600 dark:text-muted-foreground">
                {profile.bio}
              </p>
            ) : (
              <p className="text-base text-zinc-500 dark:text-muted-foreground">{t.profileNoBio}</p>
            )}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border lg:p-7">
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
