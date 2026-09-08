import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { getUserModerationRole } from "@/lib/moderation";
import { MODERATION_ACTIONS, canPerformModerationAction } from "@/lib/moderation-policy.mjs";
import { getServerSession } from "@/lib/server-session";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import { getUserStatusRow, isUserBanned } from "@/lib/user-status";

const getAdminPageActor = cache(async () => {
  const { cookieStore, supabase, user } = await getServerSession();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  if (!admin) redirect("/");

  // These reads depend on the verified user, but not on each other. React's
  // render cache expires before the next request; it never caches privileges
  // across requests or replaces permission checks on writes or database RLS.
  const [accessUser, actorStatus] = await Promise.all([
    getLatestAuthUser(admin, user.id, "admin page access"),
    getUserStatusRow(admin, user.id),
  ]);
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";

  return { admin, supabase, language, accessUser, actorStatus, user };
});

export async function requireAdminPageAction(action) {
  const { accessUser, actorStatus, ...context } = await getAdminPageActor();
  const role = getUserModerationRole(accessUser);
  const deniedHref = action === MODERATION_ACTIONS.viewDashboard ? "/" : "/admin";
  if (!accessUser || !canPerformModerationAction(role, action)) redirect(deniedHref);
  if (actorStatus.error || actorStatus.available !== true) redirect("/");
  if (isUserBanned(actorStatus.data)) redirect("/banned");

  return { ...context, role, t: translations[context.language] ?? translations.en };
}
