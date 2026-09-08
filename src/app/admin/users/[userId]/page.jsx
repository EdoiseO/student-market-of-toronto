import { adminUserHistoryHref, getAdminQueueReturnHref } from "@/lib/admin-queue-navigation.mjs";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminUserDetailContent } from "@/components/admin-user-detail-content";
import { Button } from "@/components/ui/button";
import {
  ADMIN_ENFORCEMENT_SANCTION_SELECT,
  normalizeAdminSanction,
} from "@/lib/admin-enforcement.mjs";
import { getUserModerationRole } from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import { getBanDisplayUntil, getUserStatusRow, isAuthUserBanned, isUserBanned } from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HISTORY_PAGE_SIZE = 20;

function parsePage(value) {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : 1;
}

export default async function AdminUserDetailPage({ params, searchParams }) {
  const { userId } = await params;
  if (!UUID_PATTERN.test(userId)) notFound();
  const query = await searchParams;
  const requestedPage = parsePage(query?.page);
  const queuePath = typeof query?.returnTo === "string" && /^\/admin\/users(?:[?#]|$)/.test(query.returnTo)
    ? "/admin/users" : "/admin/enforcement";
  const returnHref = getAdminQueueReturnHref(query?.returnTo, queuePath);
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] ?? translations.en;
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!admin) redirect("/admin/users");
  const accessUser = await getLatestAuthUser(admin, user.id, "admin user detail access");
  const currentUserRole = getUserModerationRole(accessUser);
  if (!accessUser || !canPerformModerationAction(currentUserRole, MODERATION_ACTIONS.readUsers)) redirect("/");
  const actorStatus = await getUserStatusRow(admin, accessUser.id);
  if (actorStatus.available !== true || actorStatus.error || isUserBanned(actorStatus.data)) redirect("/");

  const [{ data: targetData, error: targetError }, profileResult, statusResult] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("id, first_name, last_name, school, created_at").eq("id", userId).maybeSingle(),
    getUserStatusRow(admin, userId),
  ]);
  const targetUser = targetData?.user;
  if (targetError || !targetUser) notFound();
  if (statusResult.available !== true || statusResult.error) {
    return (
      <main className="min-h-screen bg-zinc-100 p-3 dark:bg-background sm:p-5 md:p-6">
        <section className="mx-auto max-w-2xl rounded-3xl border border-amber-300/60 bg-card p-6 shadow-sm dark:border-amber-500/30">
          <h1 className="text-xl font-semibold">{t.adminUsersStatusUnavailableTitle}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.adminUsersStatusUnavailableDescription}</p>
          <Button asChild variant="outline" className="mt-4 rounded-xl"><Link href="/admin/users">{t.adminUsers}</Link></Button>
        </section>
      </main>
    );
  }

  const from = (requestedPage - 1) * HISTORY_PAGE_SIZE;
  const to = from + HISTORY_PAGE_SIZE - 1;
  const [sanctionsResult, reportsCountResult, listingsCountResult, conversationsCountResult, reportsResult, listingsResult] = await Promise.all([
    admin.from("moderation_sanctions").select(ADMIN_ENFORCEMENT_SANCTION_SELECT, { count: "exact" }).eq("subject_user_id_snapshot", userId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to),
    admin.from("reports").select("id", { count: "exact", head: true }).eq("reported_user_id", userId),
    admin.from("listings").select("id", { count: "exact", head: true }).eq("seller_id", userId),
    admin.from("conversations").select("id", { count: "exact", head: true }).or(`buyer_id.eq.${userId},seller_id.eq.${userId}`),
    admin.from("reports").select("id, subject_type, reason, status, created_at").eq("reported_user_id", userId).order("created_at", { ascending: false }).limit(5),
    admin.from("listings").select("id, slug, title, status, created_at").eq("seller_id", userId).order("created_at", { ascending: false }).limit(5),
  ]);
  if (sanctionsResult.error) {
    console.error("Failed to load user enforcement history:", sanctionsResult.error.code ?? "unknown_error");
  }
  const sanctionCount = sanctionsResult.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(sanctionCount / HISTORY_PAGE_SIZE));
  if (!sanctionsResult.error && requestedPage > pageCount) redirect(adminUserHistoryHref(userId, pageCount, returnHref));

  const identityIds = [...new Set((sanctionsResult.data ?? []).flatMap((row) => [row.issued_by_user_id_snapshot, row.reviewed_by_user_id_snapshot]).filter(Boolean))];
  const identityProfiles = identityIds.length
    ? await admin.from("profiles").select("id, first_name, last_name, school").in("id", identityIds)
    : { data: [], error: null };
  const profilesById = new Map((identityProfiles.data ?? []).map((profile) => [profile.id, profile]));
  if (profileResult.data) profilesById.set(userId, profileResult.data);

  const applicationBanned = isUserBanned(statusResult.data);
  const legacyBanned = !applicationBanned && isAuthUserBanned(targetUser);
  const bannedUntil = applicationBanned ? statusResult.data?.banned_until : legacyBanned ? targetUser.banned_until : null;
  const profileName = [profileResult.data?.first_name, profileResult.data?.last_name].filter(Boolean).join(" ").trim();
  const canReadPrivateAuthDetails = currentUserRole === "admin";

  return (
    <main className="min-h-screen min-w-0 bg-zinc-100 px-4 py-4 dark:bg-background sm:px-5 lg:p-8">
      <AdminUserDetailContent
        returnHref={returnHref}
        user={{
          id: userId,
          email: canReadPrivateAuthDetails ? targetUser.email ?? "" : null,
          name: profileName || "Student",
          school: profileResult.data?.school ?? "Toronto student",
          role: getUserModerationRole(targetUser),
          createdAt: targetUser.created_at,
          lastSignInAt: canReadPrivateAuthDetails ? targetUser.last_sign_in_at : null,
          emailConfirmedAt: canReadPrivateAuthDetails ? targetUser.email_confirmed_at : null,
          isBanned: applicationBanned || legacyBanned,
          bannedUntil: getBanDisplayUntil(bannedUntil),
          banReason: statusResult.data?.ban_reason ?? null,
        }}
        currentUserId={accessUser.id}
        currentUserRole={currentUserRole}
        sanctions={(sanctionsResult.data ?? []).map((row) => normalizeAdminSanction(row, profilesById))}
        page={requestedPage}
        pageCount={pageCount}
        summaries={{
          reports: reportsCountResult.count ?? 0,
          listings: listingsCountResult.count ?? 0,
          conversations: conversationsCountResult.count ?? 0,
          sanctions: sanctionCount,
        }}
        recentReports={reportsResult.data ?? []}
        recentListings={listingsResult.data ?? []}
        loadError={Boolean(
          sanctionsResult.error
          || profileResult.error
          || statusResult.available !== true
          || statusResult.error
          || reportsCountResult.error
          || listingsCountResult.error
          || conversationsCountResult.error
          || reportsResult.error
          || listingsResult.error
        )}
      />
    </main>
  );
}
