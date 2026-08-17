import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getUserModerationRole } from "@/lib/moderation";
import { canPerformModerationAction } from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import { getUserStatusRow, isUserBanned } from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

export async function requireAdminPageAction(action, label) {
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!admin) redirect("/");

  const accessUser = await getLatestAuthUser(admin, user.id, label);
  const role = getUserModerationRole(accessUser);
  if (!accessUser || !canPerformModerationAction(role, action)) redirect("/admin");

  const actorStatus = await getUserStatusRow(admin, user.id);
  if (actorStatus.error || actorStatus.available === false) redirect("/");
  if (isUserBanned(actorStatus.data)) redirect("/banned");

  return { admin, supabase, language, role, t: translations[language] ?? translations.en, user };
}
