import { ArrowLeft, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminUsersManagement } from "@/components/admin-users-management";
import { Button } from "@/components/ui/button";
import {
  getUserModerationRole,
} from "@/lib/moderation";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import {
  getBanDisplayUntil,
  getUserStatusRow,
  isAuthUserBanned,
  isUserBanned,
} from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

function getUserName(profile, t) {
  const profileName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();

  return profileName || t.student;
}

function getDirectoryHref({ page, query, role }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (role !== "all") params.set("role", role);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/admin/users?${suffix}` : "/admin/users";
}

async function listUsersPage(admin, { page, query, role, perPage = 50 }) {
  const { data, error } = await admin.rpc("list_admin_user_directory", {
    p_query: query,
    p_role: role,
    p_page: page,
    p_page_size: perPage,
  });
  if (error) throw error;
  const total = Number(data?.total ?? 0);
  return {
    users: Array.isArray(data?.users) ? data.users : [],
    total,
    lastPage: Math.max(1, Math.ceil(total / perPage)),
    perPage,
  };
}

export default async function AdminUsersPage({ searchParams }) {
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
                <span>{t.backToAdminOverview}</span>
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

  const actorStatus = await getUserStatusRow(admin, user.id);
  if (actorStatus.error || actorStatus.available === false) redirect("/");
  if (isUserBanned(actorStatus.data)) redirect("/banned");

  const params = await searchParams;
  const requestedPage = Math.min(10000, Math.max(1, Number.parseInt(params?.page, 10) || 1));
  const query = (params?.q ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  const role = ["all", "standard", "admin", "moderator", "staff"].includes(params?.role)
    ? params.role
    : "all";
  let directory;
  try {
    directory = await listUsersPage(admin, { page: requestedPage, query, role });
  } catch (directoryError) {
    console.error("Failed to load bounded admin user directory:", directoryError?.code ?? "unknown_error");
  }

  if (!directory) {
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

  if (requestedPage > directory.lastPage) {
    const normalized = new URLSearchParams();
    if (query) normalized.set("q", query);
    if (role !== "all") normalized.set("role", role);
    normalized.set("page", String(directory.lastPage));
    redirect(`/admin/users?${normalized}`);
  }

  const users = directory.users
    .map((directoryUser) => {
      const applicationBanActive = isUserBanned(directoryUser);
      const legacyAuthBanActive = !applicationBanActive && isAuthUserBanned({
        banned_until: directoryUser.auth_banned_until,
      });
      const bannedUntil = applicationBanActive
        ? directoryUser.banned_until ?? null
        : legacyAuthBanActive
          ? directoryUser.auth_banned_until
          : null;

      return {
        id: directoryUser.id,
        email: directoryUser.email ?? t.unknown,
        name: getUserName(directoryUser, t),
        school: directoryUser.school ?? t.torontoStudent,
        role: directoryUser.moderation_role,
        createdAt: directoryUser.created_at,
        isBanned: applicationBanActive || legacyAuthBanActive,
        bannedUntil: getBanDisplayUntil(bannedUntil),
        requiresNameChange: directoryUser.force_name_change === true,
        profileExists: directoryUser.profile_exists === true,
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
                  <span>{t.backToAdminOverview}</span>
                </Link>
              </Button>
            </div>
          </div>

          <div className="p-5 md:p-8 md:pt-6">
            <AdminUsersManagement
              users={users}
              currentUserId={user.id}
              currentUserRole={getUserModerationRole(accessUser)}
              pagination={{
                page: requestedPage,
                totalPages: directory.lastPage,
                total: directory.total,
                query,
                role,
                previousHref: getDirectoryHref({ page: requestedPage - 1, query, role }),
                nextHref: getDirectoryHref({ page: requestedPage + 1, query, role }),
              }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
