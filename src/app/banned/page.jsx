import { ShieldAlert } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BannedAccountActions } from "@/components/banned-account-actions";
import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getBanDisplayUntil, getUserStatusRow, isUserBanned } from "@/lib/user-status";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

export default async function BannedPage() {
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

  const userStatusResult = await getUserStatusRow(supabase, user.id);
  const userStatusUnavailable =
    userStatusResult.available !== true || Boolean(userStatusResult.error);

  if (!userStatusUnavailable && !isUserBanned(userStatusResult.data)) {
    redirect("/");
  }

  const bannedUntil = getBanDisplayUntil(userStatusResult.data?.banned_until);
  const banReason = userStatusResult.data?.ban_reason?.trim() || null;

  return (
    <main className="min-h-screen bg-zinc-100 px-5 py-8 dark:bg-background md:px-6 md:py-10 lg:px-7">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <Card className="w-full rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:border-border dark:bg-card">
          <CardHeader className="border-b border-zinc-200 px-6 py-6 text-center dark:border-border">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <ShieldAlert className="size-6" />
            </div>
            <CardTitle className="mt-4 text-2xl text-zinc-950 dark:text-foreground">
              {userStatusUnavailable ? t.standingLoadErrorTitle : t.accountBannedTitle}
            </CardTitle>
            <CardDescription className="mt-2 text-base">
              {userStatusUnavailable
                ? t.standingLoadErrorDescription
                : t.accountBannedDescription}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 px-6 py-6 text-center">
            {!userStatusUnavailable ? (
              <>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-left dark:border-border dark:bg-muted/40">
                  <p className="text-sm font-medium text-zinc-600 dark:text-muted-foreground">
                    {t.accountBannedReasonLabel}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-950 dark:text-foreground">
                    {banReason || t.accountBannedReasonFallback}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 dark:border-border dark:bg-muted/40">
                  <p className="text-sm font-medium text-zinc-600 dark:text-muted-foreground">
                    {t.accountBannedUntilLabel}
                  </p>
                  <div className="mt-2 text-base font-semibold text-zinc-950 dark:text-foreground">
                    {bannedUntil ? (
                      <ClientFormattedDateTime value={bannedUntil} language={language} />
                    ) : (
                      t.accountBannedPermanent
                    )}
                  </div>
                </div>
              </>
            ) : null}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                asChild
                variant="outline"
                className="h-auto min-h-11 max-w-full whitespace-normal rounded-xl px-3 py-2 text-center"
              >
                <Link href="/dashboard/standing">{t.accountStanding}</Link>
              </Button>
              <BannedAccountActions />
              <Button
                asChild
                variant="outline"
                className="h-auto min-h-11 max-w-full whitespace-normal break-all rounded-xl px-3 py-2 text-center"
              >
                <a href="mailto:support@studentmarketoftoronto.ca">support@studentmarketoftoronto.ca</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
