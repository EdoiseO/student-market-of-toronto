import { ArrowLeft, ShieldCheck, Users } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminUsersManagement } from "@/components/admin-users-management";
import { Button } from "@/components/ui/button";
import { getUserModerationRole, isModerationRole } from "@/lib/moderation";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

function getUserName(profile, authUser, t) {
  const profileName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const metadataName = [authUser?.user_metadata?.first_name, authUser?.user_metadata?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return profileName || metadataName || t.student;
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

  const accessUser = (await getLatestAuthUser(admin, user.id, "admin users access")) ?? user;

  if (!isModerationRole(getUserModerationRole(accessUser))) {
    redirect("/");
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

  const authUsers = await listAllUsers(admin);
  const profileIds = authUsers.map((authUser) => authUser.id);
  const { data: profiles, error: profilesError } = profileIds.length
    ? await (admin ?? supabase)
        .from("profiles")
        .select("id, first_name, last_name, school")
        .in("id", profileIds)
    : { data: [], error: null };

  if (profilesError) {
    console.error("Failed to load admin user profiles:", profilesError.message);
  }

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  const users = authUsers
    .map((authUser) => {
      const profile = profilesById.get(authUser.id);
      const role = getUserModerationRole(authUser);

      return {
        id: authUser.id,
        email: authUser.email ?? t.unknown,
        name: getUserName(profile, authUser, t),
        school: profile?.school ?? authUser.user_metadata?.school ?? t.torontoStudent,
        role,
        createdAt: authUser.created_at,
        isBanned: Boolean(authUser.banned_until),
        bannedUntil: authUser.banned_until ?? null,
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
          <div className="border-b border-zinc-200 px-6 py-5 dark:border-border lg:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700 dark:bg-muted dark:text-muted-foreground">
                  <ShieldCheck className="size-4" />
                  <span>{t.adminDashboard}</span>
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-foreground lg:text-4xl">
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

          <div className="p-8 pt-6">
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
