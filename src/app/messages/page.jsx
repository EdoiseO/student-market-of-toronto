import { MessageSquare } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConversationList } from "@/components/conversation-list";
import { Button } from "@/components/ui/button";
import {
  CONVERSATION_MODERATION_STATE_SELECT,
  normalizeConversationModerationState,
} from "@/lib/conversation-moderation.mjs";
import {
  isAnnouncementConversationRow,
  isConversationInboxVisibleForUser,
  MESSAGE_CONVERSATION_SELECT,
  MESSAGE_LISTING_IMAGE_LIMIT,
  isConversationUserStateDeletedAtColumnMissing,
  isConversationUserStateTableMissing,
  normalizeConversationRow,
} from "@/lib/messages";
import { CONVERSATION_INBOX_LIMIT } from "@/lib/message-pagination.mjs";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

function parseInboxCursor(searchParams) {
  const updatedAt = searchParams?.before;
  const conversationId = searchParams?.beforeId;
  const parsedUpdatedAt = typeof updatedAt === "string" ? Date.parse(updatedAt) : Number.NaN;
  const isUuid =
    typeof conversationId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId);

  if (Number.isNaN(parsedUpdatedAt) || !isUuid) {
    return null;
  }

  return {
    // Keep PostgreSQL's full timestamp precision for a lossless keyset cursor.
    // Date parsing above is validation only; serializing through Date would
    // truncate microseconds and could skip rows sharing the same millisecond.
    updatedAt,
    conversationId,
  };
}

export default async function MessagesPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const inboxCursor = parseInboxCursor(resolvedSearchParams);
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

  const { data: inboxIdRows, error: inboxIdsError } = await supabase.rpc(
    "get_message_inbox_conversation_ids",
    {
      p_before_updated_at: inboxCursor?.updatedAt ?? null,
      p_before_conversation_id: inboxCursor?.conversationId ?? null,
      p_limit: CONVERSATION_INBOX_LIMIT + 1,
    },
  );
  const boundedInboxIdRows = (inboxIdRows ?? []).slice(0, CONVERSATION_INBOX_LIMIT);
  const inboxConversationIds = boundedInboxIdRows.map((row) => row.conversation_id);
  const hasOlderConversations = (inboxIdRows?.length ?? 0) > CONVERSATION_INBOX_LIMIT;
  const oldestConversationCursor = boundedInboxIdRows.at(-1);
  const { data: conversationRows, error: conversationsError } = inboxConversationIds.length
    ? await supabase
        .from("conversations")
        .select(MESSAGE_CONVERSATION_SELECT)
        .order("position", { referencedTable: "listings.listing_images", ascending: true })
        .limit(MESSAGE_LISTING_IMAGE_LIMIT, { referencedTable: "listings.listing_images" })
        .in("id", inboxConversationIds)
        .limit(CONVERSATION_INBOX_LIMIT)
    : { data: [], error: inboxIdsError };

  if (conversationsError) {
    console.error("Failed to load conversations:", conversationsError.message);
  }

  const hasMessagingSetupError = Boolean(inboxIdsError || conversationsError);
  const boundedConversationRows = conversationRows ?? [];
  const boundedConversationIds = boundedConversationRows.map((conversation) => conversation.id);
  const conversationStateResult = boundedConversationIds.length
    ? await supabase
        .from("conversation_user_state")
        .select("conversation_id, hidden_at, deleted_at")
        .eq("user_id", user.id)
        .in("conversation_id", boundedConversationIds)
    : { data: [], error: null };

  let conversationStateRows = [];

  const {
    data: conversationStateRowsWithDelete,
    error: conversationStateError,
  } = conversationStateResult;

  if (conversationStateError && isConversationUserStateDeletedAtColumnMissing(conversationStateError)) {
    const { data: fallbackConversationStateRows, error: fallbackConversationStateError } =
      boundedConversationIds.length
        ? await supabase
            .from("conversation_user_state")
            .select("conversation_id, hidden_at")
            .eq("user_id", user.id)
            .in("conversation_id", boundedConversationIds)
        : { data: [], error: null };

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

  const visibleConversationRows = boundedConversationRows.filter((conversation) => {
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

  const [unreadResult, moderationStateResult] = conversationIds.length
    ? await Promise.all([
        supabase.rpc("get_conversation_unread_counts", {
          p_conversation_ids: conversationIds,
        }),
        supabase
          .from("conversation_effective_moderation_state")
          .select(CONVERSATION_MODERATION_STATE_SELECT)
          .in("conversation_id", conversationIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  const { data: unreadRows, error: unreadError } = unreadResult;
  const { data: moderationStateRows, error: moderationStateError } = moderationStateResult;

  if (unreadError) {
    console.error("Failed to load unread message counts:", unreadError.message);
  }

  if (moderationStateError) {
    console.error("Failed to load conversation moderation states:", moderationStateError.message);
  }

  const unreadCountByConversationId = (unreadRows ?? []).reduce((counts, row) => {
    counts[row.conversation_id] = Number(row.unread_count ?? 0);
    return counts;
  }, {});

  const moderationStateByConversationId = new Map(
    (moderationStateRows ?? []).map((moderationState) => [
      moderationState.conversation_id,
      normalizeConversationModerationState(moderationState),
    ]),
  );

  const conversations = sortedConversationRows.map((conversation) => ({
    ...normalizeConversationRow(
      conversation,
      user.id,
      t,
      unreadCountByConversationId[conversation.id] ?? 0,
    ),
    moderationState: moderationStateByConversationId.get(conversation.id) ?? null,
  }));

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
          <>
            <ConversationList
              conversations={conversations}
              currentUserId={user.id}
              label={t.messages}
            />
            {inboxCursor || hasOlderConversations ? (
              <nav
                aria-label={t.conversationPaginationLabel}
                className="flex items-center justify-between gap-3 border-t border-border px-4 py-4 md:px-6"
              >
                {inboxCursor ? (
                  <Button asChild variant="outline">
                    <Link href="/messages">{t.newerConversations}</Link>
                  </Button>
                ) : <span />}
                {hasOlderConversations && oldestConversationCursor ? (
                  <Button asChild variant="outline">
                    <Link
                      href={`/messages?${new URLSearchParams({
                        before: oldestConversationCursor.conversation_updated_at,
                        beforeId: oldestConversationCursor.conversation_id,
                      })}`}
                    >
                      {t.olderConversations}
                    </Link>
                  </Button>
                ) : null}
              </nav>
            ) : null}
          </>
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
