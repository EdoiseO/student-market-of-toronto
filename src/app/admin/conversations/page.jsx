import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminConversationRegistry } from "@/components/admin-conversation-registry";
import {
  ADMIN_CONVERSATION_PAGE_SIZE,
  normalizeAdminConversationFilter,
  normalizeAdminConversationPage,
  normalizeAdminConversationRegistryRow,
  normalizeAdminConversationSearch,
} from "@/lib/admin-conversations.mjs";
import { getUserModerationRole } from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

export default async function AdminConversationsPage({ searchParams }) {
  const query = await searchParams;
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();
  const filter = normalizeAdminConversationFilter(query?.filter);
  const search = normalizeAdminConversationSearch(query?.q);
  const page = normalizeAdminConversationPage(query?.page);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const accessUser = admin
    ? await getLatestAuthUser(admin, user.id, "admin conversation registry access")
    : user;
  const role = getUserModerationRole(accessUser);

  if (!accessUser || !canPerformModerationAction(role, MODERATION_ACTIONS.readConversations)) {
    redirect("/");
  }

  let loadError = !admin;
  let rows = [];

  if (admin) {
    const { data, error } = await admin.rpc("admin_list_conversations", {
      p_actor_id: accessUser.id,
      p_filter: filter,
      p_search: search,
      p_page: page,
      p_page_size: ADMIN_CONVERSATION_PAGE_SIZE,
    });

    if (error) {
      loadError = true;
      console.error("Failed to load admin conversation registry:", error.message);
    } else {
      rows = data ?? [];
    }
  }

  const totalCount = Number(rows[0]?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_CONVERSATION_PAGE_SIZE));

  return (
    <AdminConversationRegistry
      conversations={rows.map(normalizeAdminConversationRegistryRow)}
      totalCount={totalCount}
      filter={filter}
      search={search}
      page={page}
      totalPages={totalPages}
      loadError={loadError}
      language={language}
      t={t}
    />
  );
}
