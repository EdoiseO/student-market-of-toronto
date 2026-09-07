import { withPrivateMessageMediaUrl } from "@/lib/private-message-media.mjs";
import { getAdminQueueReturnHref } from "@/lib/admin-queue-navigation.mjs";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminConversationDetail } from "@/components/admin-conversation-detail";
import { Button } from "@/components/ui/button";
import {
  ADMIN_CONVERSATION_MESSAGE_REQUEST_LIMIT,
  isUuid,
  normalizeAdminConversationMessagePage,
} from "@/lib/admin-conversations.mjs";
import { getUserModerationRole } from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

function parseCursor(searchParams) {
  const beforeCreatedAt =
    typeof searchParams?.beforeCreatedAt === "string"
      ? searchParams.beforeCreatedAt.trim()
      : "";
  const beforeMessageId =
    typeof searchParams?.beforeMessageId === "string"
      ? searchParams.beforeMessageId.trim()
      : "";
  const parsedTimestamp = Date.parse(beforeCreatedAt);

  if (!Number.isFinite(parsedTimestamp) || !isUuid(beforeMessageId)) {
    return { beforeCreatedAt: null, beforeMessageId: null };
  }

  return {
    beforeCreatedAt: new Date(parsedTimestamp).toISOString(),
    beforeMessageId,
  };
}

function LoadError({ t }) {
  return (
    <main className="min-h-screen bg-zinc-100 px-3 py-4 dark:bg-background sm:px-5 md:p-6 lg:p-7">
      <div className="mx-auto max-w-3xl rounded-[2rem] border border-border bg-card p-6 text-center shadow-sm md:p-10">
        <AlertTriangle className="mx-auto size-9 text-amber-600" />
        <h1 className="mt-4 text-xl font-semibold text-foreground">
          {t.adminConversationLoadErrorTitle}
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {t.adminConversationLoadErrorDescription}
        </p>
        <Button asChild variant="outline" className="mt-6 rounded-full">
          <Link href="/admin/conversations">
            <ArrowLeft className="size-4" />
            {t.adminConversationsBackAction}
          </Link>
        </Button>
      </div>
    </main>
  );
}

export default async function AdminConversationDetailPage({ params, searchParams }) {
  const [{ conversationId }, query] = await Promise.all([params, searchParams]);

  if (!isUuid(conversationId)) {
    notFound();
  }

  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();
  const cursor = parseCursor(query);
  const returnHref = getAdminQueueReturnHref(query?.returnTo, "/admin/conversations");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const accessUser = admin
    ? await getLatestAuthUser(admin, user.id, "admin conversation detail access")
    : user;
  const role = getUserModerationRole(accessUser);

  if (!accessUser || !canPerformModerationAction(role, MODERATION_ACTIONS.readConversations)) {
    redirect("/");
  }

  if (!admin) {
    return <LoadError t={t} />;
  }

  const [detailResult, messageResult] = await Promise.all([
    admin.rpc("admin_get_conversation_detail", {
      p_actor_id: accessUser.id,
      p_conversation_id: conversationId,
    }),
    admin.rpc("admin_get_conversation_message_page", {
      p_actor_id: accessUser.id,
      p_conversation_id: conversationId,
      p_before_created_at: cursor.beforeCreatedAt,
      p_before_message_id: cursor.beforeMessageId,
      p_limit: ADMIN_CONVERSATION_MESSAGE_REQUEST_LIMIT,
    }),
  ]);

  const notFoundError = [detailResult.error, messageResult.error].find(
    (error) => error?.code === "P0002" || error?.message?.includes("conversation_not_found"),
  );

  if (notFoundError) {
    notFound();
  }

  if (detailResult.error || messageResult.error || !detailResult.data) {
    console.error(
      "Failed to load admin conversation detail:",
      detailResult.error?.message ?? messageResult.error?.message ?? "Missing detail payload",
    );
    return <LoadError t={t} />;
  }

  const { messages, hasOlderMessages } = normalizeAdminConversationMessagePage(
    messageResult.data ?? [],
  );
  const messagesWithSignedEvidence = messages.map((message) => ({
    ...message,
    attachments: message.attachments.map(withPrivateMessageMediaUrl),
  }));
  const oldestMessage = messagesWithSignedEvidence[0] ?? null;
  const olderMessagesHref =
    hasOlderMessages && oldestMessage
      ? `/admin/conversations/${conversationId}?beforeCreatedAt=${encodeURIComponent(
          oldestMessage.createdAt,
        )}&beforeMessageId=${encodeURIComponent(oldestMessage.id)}&returnTo=${encodeURIComponent(returnHref)}`
      : null;

  return (
    <AdminConversationDetail
      detail={detailResult.data}
      messages={messagesWithSignedEvidence}
      hasOlderMessages={hasOlderMessages}
      olderMessagesHref={olderMessagesHref}
      returnHref={returnHref}
      role={role}
      language={language}
      t={t}
    />
  );
}
