import { ArrowLeft, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminUsersManagement } from "@/components/admin-users-management";
import { Button } from "@/components/ui/button";
import {
  getUserModerationRole,
  isNameChangeRequired,
} from "@/lib/moderation";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import {
  getBanDisplayUntil,
  isAuthUserBanned,
  isUserBanned,
} from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

function getUserName(profile, t) {
  const profileName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();

  return profileName || t.student;
}

async function listAllUsers(admin) {
  const users = [];
  const perPage = 200;

  for (let page = 1; page <= 20; page += 1) {
    const {
      data: { users: pageUsers },
      error,
    } = await admin.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    users.push(...(pageUsers ?? []));

    if (!pageUsers || pageUsers.length < perPage) {
      break;
    }
  }

  return users;
}

export default async function AdminUsersPage() {
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (!admin) {
    return (
      <main className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-7">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button asChild variant="ghost" className="h-9 rounded-full px-3">
              <Link href="/admin">
                <ArrowLeft className="size-4" />
                <span>{t.backToAdminReports}</span>
              </Link>
            </Button>
            <div className="flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
              <Users className="size-4" />
              <span>{t.adminUsers}</span>
            </div>
          </div>

          <div className="rounded-[2rem] border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            {t.adminUsersSetupDescription}
          </div>
        </div>
      </main>
    );
  }

  const accessUser = await getLatestAuthUser(admin, user.id, "admin users access");

  if (!accessUser || getUserModerationRole(accessUser) !== "admin") {
    redirect("/");
  }

  const authUsers = await listAllUsers(admin);
  const profileIds = authUsers.map((authUser) => authUser.id);
  const [profilesResult, statusResult] = profileIds.length
    ? await Promise.all([
        (admin ?? supabase)
          .from("profiles")
          .select("id, first_name, last_name, school")
          .in("id", profileIds),
        admin
          .from("user_status")
          .select("user_id, is_banned, banned_until, ban_reason, updated_at")
          .in("user_id", profileIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  const { data: profiles, error: profilesError } = profilesResult;
  const { data: statusRows, error: statusError } = statusResult;

  if (profilesError) {
    console.error("Failed to load admin user profiles:", profilesError.message);
  }

  if (statusError) {
    console.error("Failed to load application ban status:", statusError.message);
  }

  if (statusError || !Array.isArray(statusRows)) {
    return (
      <main className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-7">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6">
          <div className="rounded-[2rem] border border-amber-300/60 bg-white p-6 shadow-sm dark:border-amber-500/30 dark:bg-card md:p-8">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300" />
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                  {t.adminUsersStatusUnavailableTitle}
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-muted-foreground">
                  {t.adminUsersStatusUnavailableDescription}
                </p>
                <Button asChild variant="outline" className="mt-4 rounded-xl">
                  <Link href="/admin/users">{t.standingRefresh}</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const statusByUserId = new Map(
    (statusRows ?? []).map((status) => [status.user_id, status]),
  );

  const users = authUsers
    .map((authUser) => {
      const profile = profilesById.get(authUser.id);
      const applicationStatus = statusByUserId.get(authUser.id);
      const role = getUserModerationRole(authUser);
      const applicationBanActive = isUserBanned(applicationStatus);
      const legacyAuthBanActive = !applicationStatus && isAuthUserBanned(authUser);
      const bannedUntil = applicationBanActive
        ? applicationStatus?.banned_until ?? null
        : legacyAuthBanActive
          ? authUser.banned_until
          : null;

      return {
        id: authUser.id,
        email: authUser.email ?? t.unknown,
        name: getUserName(profile, t),
        school: profile?.school ?? t.torontoStudent,
        role,
        createdAt: authUser.created_at,
        isBanned: applicationBanActive || legacyAuthBanActive,
        bannedUntil: getBanDisplayUntil(bannedUntil),
        requiresNameChange: isNameChangeRequired(authUser),
        profileExists: Boolean(profile),
      };
    })
    .sort((firstUser, secondUser) => {
      return new Date(secondUser.createdAt ?? 0).getTime() - new Date(firstUser.createdAt ?? 0).getTime();
    });

  return (
    <main className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-7">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 @container/main">
        <div className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
          <div className="border-b border-zinc-200 px-5 py-5 dark:border-border md:px-6 lg:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700 dark:bg-muted dark:text-muted-foreground">
                  <ShieldCheck className="size-4" />
                  <span>{t.adminDashboard}</span>
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-foreground md:text-3xl lg:text-4xl">
                  {t.adminUsers}
                </h1>
                <p className="max-w-3xl text-base text-zinc-600 dark:text-muted-foreground">
                  {t.adminUsersPageHeaderDescription}
                </p>
              </div>

              <Button asChild variant="outline" className="rounded-xl">
                <Link href="/admin">
                  <ArrowLeft className="size-4" />
                  <span>{t.backToAdminReports}</span>
                </Link>
              </Button>
            </div>
          </div>

          <div className="p-5 md:p-8 md:pt-6">
            <AdminUsersManagement
              users={users}
              currentUserId={user.id}
              currentUserRole={getUserModerationRole(accessUser)}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
