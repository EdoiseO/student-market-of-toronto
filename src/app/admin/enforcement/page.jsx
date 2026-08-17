import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminEnforcementContent } from "@/components/admin-enforcement-content";
import {
  ADMIN_ENFORCEMENT_PAGE_SIZE,
  ADMIN_ENFORCEMENT_SANCTION_SELECT,
  getAdminEnforcementHref,
  normalizeAdminSanction,
  parseAdminEnforcementFilters,
} from "@/lib/admin-enforcement.mjs";
import { getUserModerationRole } from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { getUserStatusRow, isUserBanned } from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeSearchTerm(value) {
  return value.replace(/[^\p{L}\p{N}@._ -]/gu, " ").replace(/\s+/g, " ").trim();
}

async function getMatchingProfileIds(admin, query) {
  const term = safeSearchTerm(query);
  if (!term) return [];
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,school.ilike.%${term}%`)
    .limit(100);
  if (error) {
    console.error("Failed to search enforcement profiles:", error.code ?? "unknown_error");
    return [];
  }
  return (data ?? []).map((profile) => profile.id);
}

export default async function AdminEnforcementPage({ searchParams }) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();
  const resolvedSearchParams = await searchParams;
  const filters = parseAdminEnforcementFilters(resolvedSearchParams);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!admin) {
    return (
      <main className="min-h-screen bg-zinc-100 px-3 py-4 dark:bg-background sm:px-5 lg:p-8">
        <AdminEnforcementContent records={[]} filters={filters} totalCount={0} pageCount={1} setupError />
      </main>
    );
  }

  const accessUser = await getLatestAuthUser(admin, user.id, "enforcement registry access");
  const accessRole = getUserModerationRole(accessUser);
  if (!accessUser || !canPerformModerationAction(accessRole, MODERATION_ACTIONS.readUsers)) {
    redirect("/");
  }
  const actorStatus = await getUserStatusRow(admin, accessUser.id);
  if (actorStatus.available !== true || actorStatus.error || isUserBanned(actorStatus.data)) {
    redirect("/");
  }

  const profileIds = filters.query ? await getMatchingProfileIds(admin, filters.query) : [];
  const from = (filters.page - 1) * ADMIN_ENFORCEMENT_PAGE_SIZE;
  const to = from + ADMIN_ENFORCEMENT_PAGE_SIZE - 1;
  const nowIso = new Date().toISOString();
  let query = admin
    .from("moderation_sanctions")
    .select(ADMIN_ENFORCEMENT_SANCTION_SELECT, { count: "exact" });

  if (filters.status === "active") {
    query = query.is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  } else if (filters.status === "review") {
    query = query
      .eq("review_status", "pending")
      .is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  } else if (filters.status === "history") {
    query = query.or(`revoked_at.not.is.null,expires_at.lte.${nowIso},review_status.in.(upheld,modified,overturned)`);
  }
  if (filters.type !== "all") query = query.eq("sanction_type", filters.type);
  if (filters.severity !== "all") query = query.eq("severity", filters.severity);
  if (filters.query) {
    const term = safeSearchTerm(filters.query);
    const terms = [
      `user_message.ilike.%${term}%`,
      `reason_code.ilike.%${term.replaceAll(" ", "_")}%`,
      ...profileIds.map((id) => `subject_user_id_snapshot.eq.${id}`),
    ];
    if (UUID_PATTERN.test(term)) terms.push(`subject_user_id_snapshot.eq.${term}`);
    query = query.or(terms.join(","));
  }

  const result = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (result.error) {
    console.error("Failed to load enforcement registry:", result.error.code ?? "unknown_error");
    return (
      <main className="min-h-screen bg-zinc-100 px-3 py-4 dark:bg-background sm:px-5 lg:p-8">
        <AdminEnforcementContent records={[]} filters={filters} totalCount={0} pageCount={1} setupError />
      </main>
    );
  }

  const totalCount = result.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / ADMIN_ENFORCEMENT_PAGE_SIZE));
  if (filters.page > pageCount) redirect(getAdminEnforcementHref(filters, pageCount));

  const identityIds = [...new Set((result.data ?? []).flatMap((row) => [
    row.subject_user_id_snapshot,
    row.issued_by_user_id_snapshot,
    row.reviewed_by_user_id_snapshot,
  ]).filter(Boolean))];
  const profilesResult = identityIds.length
    ? await admin.from("profiles").select("id, first_name, last_name, school").in("id", identityIds)
    : { data: [], error: null };
  if (profilesResult.error) {
    console.error("Failed to load enforcement identities:", profilesResult.error.code ?? "unknown_error");
  }
  const profilesById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));

  return (
    <main className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-3 py-4 dark:bg-background sm:px-5 lg:p-8">
      <AdminEnforcementContent
        records={(result.data ?? []).map((row) => normalizeAdminSanction(row, profilesById))}
        filters={filters}
        totalCount={totalCount}
        pageCount={pageCount}
      />
    </main>
  );
}
