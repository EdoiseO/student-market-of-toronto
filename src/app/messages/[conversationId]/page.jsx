import { ArrowLeft, MessageSquare } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { MessagesThread } from "@/components/messages-thread";
import { Button } from "@/components/ui/button";
import {
  filterConversationMessagesForUser,
  isConversationHiddenForUser,
  MESSAGE_CONVERSATION_SELECT,
  isConversationUserStateDeletedAtColumnMissing,
  isConversationUserStateTableMissing,
  normalizeConversationRow,
} from "@/lib/messages";
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

  const { data: conversationStateRowWithDelete, error: conversationStateError } = conversationRow
    ? await supabase
        .from("conversation_user_state")
        .select("hidden_at, deleted_at")
        .eq("conversation_id", conversationRow.id)
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null, error: null };

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

  const { data: messageRows, error: messagesError } = conversationRow
    ? await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, body, created_at, read_at")
        .eq("conversation_id", conversationRow.id)
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (messagesError) {
    console.error("Failed to load conversation messages:", messagesError.message);
  }

  const visibleMessageRows = filterConversationMessagesForUser(messageRows ?? [], deletedAt);
  const unreadCount = visibleMessageRows.filter(
    (message) => !message.read_at && message.sender_id !== user.id,
  ).length;

  const conversation = conversationRow
    ? normalizeConversationRow(conversationRow, user.id, t, unreadCount)
    : null;
  const isHiddenConversation = conversationRow
    ? isConversationHiddenForUser(conversationRow, hiddenAt, deletedAt)
    : false;

  return (
    <main className="h-full min-h-0 overflow-hidden bg-zinc-100 px-5 pt-3 pb-5 dark:bg-background md:px-6 md:pt-3 md:pb-6 lg:px-7 lg:pt-4 lg:pb-7">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1040px] flex-col gap-1 overflow-hidden">
        {hasMessagingSetupError ? (
          <section className="flex min-h-[420px] items-center justify-center rounded-[2rem] border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-border dark:bg-muted/40">
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
            <div>
              <Button asChild variant="ghost" className="h-9 rounded-full px-3">
                <Link href="/messages">
                  <ArrowLeft className="size-4" />
                  <span>{t.backToMessages}</span>
                </Link>
              </Button>
            </div>

            <MessagesThread
              conversation={conversation}
              currentUserId={user.id}
              initialMessages={visibleMessageRows}
              hasDeletedMessages={Boolean(deletedAt)}
              isHiddenConversation={isHiddenConversation}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
