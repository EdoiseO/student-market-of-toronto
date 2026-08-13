import { ArrowLeft, MessageSquare } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { MessagesThread } from "@/components/messages-thread";
import { Button } from "@/components/ui/button";
import {
  isConversationHiddenForUser,
  MESSAGE_CONVERSATION_SELECT,
  MESSAGE_LISTING_IMAGE_LIMIT,
  isConversationUserStateDeletedAtColumnMissing,
  isConversationUserStateTableMissing,
  normalizeConversationRow,
} from "@/lib/messages";
import {
  MESSAGE_PAGE_REQUEST_LIMIT,
  normalizeMessagePageRows,
} from "@/lib/message-pagination.mjs";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

export default async function ConversationPage({ params }) {
  const resolvedParams = await params;
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

  const { data: conversationRow, error: conversationError } = await supabase
    .from("conversations")
    .select(MESSAGE_CONVERSATION_SELECT)
    .order("position", { referencedTable: "listings.listing_images", ascending: true })
    .limit(MESSAGE_LISTING_IMAGE_LIMIT, { referencedTable: "listings.listing_images" })
    .eq("id", resolvedParams.conversationId)
    .maybeSingle();

  if (conversationError) {
    console.error("Failed to load conversation:", conversationError.message);
  }

  const hasMessagingSetupError = Boolean(conversationError);

  if (!hasMessagingSetupError && !conversationRow) {
    notFound();
  }

  let conversationStateRow = null;
  const conversationStatePromise = conversationRow
    ? supabase
        .from("conversation_user_state")
        .select("hidden_at, deleted_at")
        .eq("conversation_id", conversationRow.id)
        .eq("user_id", user.id)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const messageRowsPromise = conversationRow
    ? supabase.rpc("get_conversation_message_page", {
        p_conversation_id: conversationRow.id,
        p_before_created_at: null,
        p_before_message_id: null,
        p_limit: MESSAGE_PAGE_REQUEST_LIMIT,
      })
    : Promise.resolve({ data: [], error: null });
  const [conversationStateResult, messagesResult] = await Promise.all([
    conversationStatePromise,
    messageRowsPromise,
  ]);
  const {
    data: conversationStateRowWithDelete,
    error: conversationStateError,
  } = conversationStateResult;
  const { data: messageRows, error: messagesError } = messagesResult;

  if (conversationStateError && isConversationUserStateDeletedAtColumnMissing(conversationStateError)) {
    const { data: fallbackConversationStateRow, error: fallbackConversationStateError } =
      conversationRow
        ? await supabase
            .from("conversation_user_state")
            .select("hidden_at")
            .eq("conversation_id", conversationRow.id)
            .eq("user_id", user.id)
            .maybeSingle()
        : { data: null, error: null };

    if (
      fallbackConversationStateError &&
      !isConversationUserStateTableMissing(fallbackConversationStateError)
    ) {
      console.error(
        "Failed to load conversation state:",
        fallbackConversationStateError.message,
      );
    } else {
      conversationStateRow = fallbackConversationStateRow
        ? { ...fallbackConversationStateRow, deleted_at: null }
        : null;
    }
  } else {
    conversationStateRow = conversationStateRowWithDelete;
  }

  if (conversationStateError && !isConversationUserStateTableMissing(conversationStateError)) {
    if (!isConversationUserStateDeletedAtColumnMissing(conversationStateError)) {
      console.error("Failed to load conversation state:", conversationStateError.message);
    }
  }

  const deletedAt = conversationStateRow?.deleted_at ?? null;
  const hiddenAt = conversationStateRow?.hidden_at ?? null;

  if (messagesError) {
    console.error("Failed to load conversation messages:", messagesError.message);
  }

  const {
    messages: visibleMessageRows,
    hasOlderMessages,
  } = normalizeMessagePageRows(messageRows ?? []);
  const visibleMessageIds = visibleMessageRows.map((message) => message.id);
  let messageAttachments = [];
  let messageReactions = [];

  if (visibleMessageIds.length > 0) {
    const [attachmentsResult, reactionsResult] = await Promise.all([
      supabase
        .from("message_attachments")
        .select("id, message_id, storage_path, file_name, mime_type, size_bytes, created_at")
        .in("message_id", visibleMessageIds)
        .order("created_at", { ascending: true }),
      supabase
        .from("message_reactions")
        .select("message_id, conversation_id, user_id, emoji, created_at, removed_at")
        .in("message_id", visibleMessageIds)
        .is("removed_at", null)
        .order("created_at", { ascending: true }),
    ]);
    const { data: attachmentRows, error: attachmentsError } = attachmentsResult;
    const { data: reactionRows, error: reactionsError } = reactionsResult;

    if (attachmentsError) {
      if (attachmentsError.code !== "42P01" && attachmentsError.code !== "PGRST205") {
        console.error("Failed to load message attachments:", attachmentsError.message);
      }
    } else if (attachmentRows?.length > 0) {
      const { data: signedRows, error: signedUrlsError } = await supabase.storage
        .from("message-media")
        .createSignedUrls(
          attachmentRows.map((attachment) => attachment.storage_path),
          60 * 60,
        );

      if (signedUrlsError) {
        console.error("Failed to sign message attachments:", signedUrlsError.message);
      }

      messageAttachments = attachmentRows.map((attachment, index) => ({
        ...attachment,
        signedUrl: signedRows?.[index]?.signedUrl ?? null,
      }));
    }

    if (reactionsError) {
      if (reactionsError.code !== "42P01" && reactionsError.code !== "PGRST205") {
        console.error("Failed to load message reactions:", reactionsError.message);
      }
    } else {
      messageReactions = reactionRows ?? [];
    }
  }

  const attachmentsByMessageId = messageAttachments.reduce((attachmentsByMessage, attachment) => {
    attachmentsByMessage[attachment.message_id] ??= [];
    attachmentsByMessage[attachment.message_id].push(attachment);
    return attachmentsByMessage;
  }, {});
  const reactionsByMessageId = messageReactions.reduce((reactionsByMessage, reaction) => {
    reactionsByMessage[reaction.message_id] ??= [];
    reactionsByMessage[reaction.message_id].push(reaction);
    return reactionsByMessage;
  }, {});
  const messagesWithAttachments = visibleMessageRows.map((message) => ({
    ...message,
    attachments: attachmentsByMessageId[message.id] ?? [],
    reactions: reactionsByMessageId[message.id] ?? [],
  }));
  const { data: unreadRows, error: unreadError } = conversationRow
    ? await supabase.rpc("get_conversation_unread_counts", {
        p_conversation_ids: [conversationRow.id],
      })
    : { data: [], error: null };

  if (unreadError) {
    console.error("Failed to load conversation unread count:", unreadError.message);
  }

  const unreadCount = Number(unreadRows?.[0]?.unread_count ?? 0);

  const conversation = conversationRow
    ? normalizeConversationRow(conversationRow, user.id, t, unreadCount)
    : null;
  const isHiddenConversation = conversationRow
    ? isConversationHiddenForUser(conversationRow, hiddenAt, deletedAt)
    : false;

  return (
    <main className="h-full min-h-0 max-w-full touch-pan-y overflow-hidden overscroll-x-none bg-white dark:bg-card md:bg-zinc-100 md:px-4 md:pb-4 md:pt-2 md:dark:bg-background lg:px-5 lg:pb-5 lg:pt-3">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1280px] flex-col overflow-hidden md:gap-0.5">
        {hasMessagingSetupError ? (
          <section className="flex min-h-[300px] items-center justify-center rounded-[2rem] border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center dark:border-border dark:bg-muted/40 md:min-h-[420px] md:p-8">
            <div className="max-w-xl">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-background text-foreground shadow-sm">
                <MessageSquare className="size-6" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold text-zinc-950 dark:text-foreground">
                {t.messagesSetupTitle}
              </h2>
              <p className="mt-3 text-sm leading-7 text-zinc-500 dark:text-muted-foreground">
                {t.messagesSetupDescription}
              </p>
              <Button asChild className="mt-6">
                <Link href="/messages">{t.conversationsTitle}</Link>
              </Button>
            </div>
          </section>
        ) : conversation ? (
          <>
            <div className="shrink-0 px-2 py-0.5 md:px-0 md:py-0">
              <Button asChild variant="ghost" className="min-h-11 rounded-full px-3">
                <Link href="/messages">
                  <ArrowLeft className="size-4" />
                  <span>{t.backToMessages}</span>
                </Link>
              </Button>
            </div>

            <MessagesThread
              conversation={conversation}
              currentUserId={user.id}
              initialMessages={messagesWithAttachments}
              initialHasOlderMessages={hasOlderMessages}
              hasDeletedMessages={Boolean(deletedAt)}
              isHiddenConversation={isHiddenConversation}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
