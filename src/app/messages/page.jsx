import { MessageSquare } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConversationListItem } from "@/components/conversation-list-item";
import { Button } from "@/components/ui/button";
import {
  isAnnouncementConversationRow,
  isConversationInboxVisibleForUser,
  isConversationMessageVisibleForUser,
  MESSAGE_CONVERSATION_SELECT,
  isConversationUserStateDeletedAtColumnMissing,
  isConversationUserStateTableMissing,
  normalizeConversationRow,
} from "@/lib/messages";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

export default async function MessagesPage() {
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

  const conversationsPromise = supabase
    .from("conversations")
    .select(MESSAGE_CONVERSATION_SELECT)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order("updated_at", { ascending: false });
  const conversationStatePromise = supabase
    .from("conversation_user_state")
    .select("conversation_id, hidden_at, deleted_at")
    .eq("user_id", user.id);
  const [conversationsResult, conversationStateResult] = await Promise.all([
    conversationsPromise,
    conversationStatePromise,
  ]);
  const { data: conversationRows, error: conversationsError } = conversationsResult;

  if (conversationsError) {
    console.error("Failed to load conversations:", conversationsError.message);
  }

  const hasMessagingSetupError = Boolean(conversationsError);

  let conversationStateRows = [];

  const {
    data: conversationStateRowsWithDelete,
    error: conversationStateError,
  } = conversationStateResult;

  if (conversationStateError && isConversationUserStateDeletedAtColumnMissing(conversationStateError)) {
    const { data: fallbackConversationStateRows, error: fallbackConversationStateError } = await supabase
      .from("conversation_user_state")
      .select("conversation_id, hidden_at")
      .eq("user_id", user.id);

    if (
      fallbackConversationStateError &&
      !isConversationUserStateTableMissing(fallbackConversationStateError)
    ) {
      console.error(
        "Failed to load conversation state:",
        fallbackConversationStateError.message,
      );
    } else {
      conversationStateRows = (fallbackConversationStateRows ?? []).map((conversationState) => ({
        ...conversationState,
        deleted_at: null,
      }));
    }
  } else {
    conversationStateRows = conversationStateRowsWithDelete ?? [];
  }

  if (conversationStateError && !isConversationUserStateTableMissing(conversationStateError)) {
    if (!isConversationUserStateDeletedAtColumnMissing(conversationStateError)) {
      console.error("Failed to load conversation state:", conversationStateError.message);
    }
  }

  const conversationStateById = new Map(
    conversationStateRows.map((conversationState) => [conversationState.conversation_id, conversationState]),
  );

  const allConversationRows = conversationRows ?? [];

  const visibleConversationRows = allConversationRows.filter((conversation) => {
    const conversationState = conversationStateById.get(conversation.id);

    return isConversationInboxVisibleForUser(
      conversation,
      conversationState?.hidden_at,
      conversationState?.deleted_at,
    );
  });

  const sortedConversationRows = visibleConversationRows.slice().sort((firstConversation, secondConversation) => {
    const firstIsAnnouncement = isAnnouncementConversationRow(firstConversation);
    const secondIsAnnouncement = isAnnouncementConversationRow(secondConversation);

    if (firstIsAnnouncement !== secondIsAnnouncement) {
      return firstIsAnnouncement ? -1 : 1;
    }

    return new Date(secondConversation.updated_at).getTime() - new Date(firstConversation.updated_at).getTime();
  });

  const conversationIds = sortedConversationRows.map((conversation) => conversation.id);

  const { data: unreadRows, error: unreadError } = conversationIds.length
    ? await supabase
        .from("messages")
        .select("conversation_id, created_at")
        .in("conversation_id", conversationIds)
        .is("read_at", null)
        .neq("sender_id", user.id)
    : { data: [], error: null };

  if (unreadError) {
    console.error("Failed to load unread message counts:", unreadError.message);
  }

  const unreadCountByConversationId = (unreadRows ?? []).reduce((counts, row) => {
    const conversationState = conversationStateById.get(row.conversation_id);

    if (!isConversationMessageVisibleForUser(row, conversationState?.deleted_at)) {
      return counts;
    }

    counts[row.conversation_id] = (counts[row.conversation_id] ?? 0) + 1;
    return counts;
  }, {});

  const conversations = sortedConversationRows.map((conversation) =>
    normalizeConversationRow(
      conversation,
      user.id,
      t,
      unreadCountByConversationId[conversation.id] ?? 0,
    )
  );

  return (
    <main className="min-h-screen min-w-0 overflow-x-clip bg-card md:bg-zinc-100 md:p-6 md:dark:bg-background lg:p-7">
      <div className="mx-auto w-full max-w-[1360px] overflow-hidden bg-card md:rounded-[2rem] md:border md:border-border md:shadow-sm">
        <header className="border-b border-border px-4 py-5 md:px-6 lg:px-7">
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl lg:text-4xl">
            {t.messages}
          </h1>
        </header>

        {hasMessagingSetupError ? (
          <section className="flex items-center justify-center px-6 py-16 text-center md:py-24">
            <div className="max-w-xl">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <MessageSquare className="size-6" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-foreground md:text-2xl">
                {t.messagesSetupTitle}
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                {t.messagesSetupDescription}
              </p>
              <Button asChild className="mt-6">
                <Link href="/">{t.browseListings}</Link>
              </Button>
            </div>
          </section>
        ) : conversations.length > 0 ? (
          <section aria-label={t.messages}>
            {conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                dateValue={conversation.lastMessageAt || conversation.updatedAt}
              />
            ))}
          </section>
        ) : (
          <section className="flex items-center justify-center px-6 py-16 text-center md:py-24">
            <div className="max-w-xl">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <MessageSquare className="size-6" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-foreground md:text-2xl">
                {t.noConversationsTitle}
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                {t.noConversationsDescription}
              </p>
              <Button asChild className="mt-6">
                <Link href="/">{t.browseListings}</Link>
              </Button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
