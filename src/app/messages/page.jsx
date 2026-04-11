import { EyeOff, MessageSquare } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConversationListItem } from "@/components/conversation-list-item";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MESSAGE_CONVERSATION_SELECT,
  isConversationUserStateTableMissing,
  normalizeConversationRow,
} from "@/lib/messages";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

export default async function MessagesPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const showHidden = resolvedSearchParams?.hidden === "1";

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

  const { data: conversationRows, error: conversationsError } = await supabase
    .from("conversations")
    .select(MESSAGE_CONVERSATION_SELECT)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order("updated_at", { ascending: false });

  if (conversationsError) {
    console.error("Failed to load conversations:", conversationsError.message);
  }

  const hasMessagingSetupError = Boolean(conversationsError);

  const { data: hiddenConversationRows, error: hiddenConversationsError } = await supabase
    .from("conversation_user_state")
    .select("conversation_id")
    .eq("user_id", user.id)
    .not("hidden_at", "is", null);

  if (
    hiddenConversationsError &&
    !isConversationUserStateTableMissing(hiddenConversationsError)
  ) {
    console.error("Failed to load hidden conversations:", hiddenConversationsError.message);
  }

  const hiddenConversationIds = new Set(
    (hiddenConversationRows ?? []).map((conversationState) => conversationState.conversation_id),
  );

  const allConversationRows = conversationRows ?? [];

  const visibleConversationRows = allConversationRows.filter(
    (conversation) =>
      Boolean(conversation.last_message_at || conversation.last_message_preview) &&
      !hiddenConversationIds.has(conversation.id),
  );

  const hiddenConversationRows2 = allConversationRows.filter(
    (conversation) => hiddenConversationIds.has(conversation.id),
  );

  const activeConversationRows = showHidden ? hiddenConversationRows2 : visibleConversationRows;
  const conversationIds = activeConversationRows.map((conversation) => conversation.id);

  const { data: unreadRows, error: unreadError } = conversationIds.length
    ? await supabase
        .from("messages")
        .select("conversation_id")
        .in("conversation_id", conversationIds)
        .is("read_at", null)
        .neq("sender_id", user.id)
    : { data: [], error: null };

  if (unreadError) {
    console.error("Failed to load unread message counts:", unreadError.message);
  }

  const unreadCountByConversationId = (unreadRows ?? []).reduce((counts, row) => {
    counts[row.conversation_id] = (counts[row.conversation_id] ?? 0) + 1;
    return counts;
  }, {});

  const conversations = activeConversationRows.map((conversation) =>
    normalizeConversationRow(
      conversation,
      user.id,
      t,
      unreadCountByConversationId[conversation.id] ?? 0,
    )
  );

  const hiddenCount = hiddenConversationIds.size;

  return (
    <main className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-7">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6">
        <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:border-border dark:bg-card">
          <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border lg:px-7">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-foreground lg:text-4xl">
                {showHidden ? t.hiddenMessages : t.messages}
              </CardTitle>
              {showHidden ? (
                <Button asChild variant="outline" className="rounded-xl">
                  <Link href="/messages">
                    <MessageSquare className="size-4" />
                    <span>{t.backToMessages}</span>
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="outline" className="rounded-xl" disabled={hiddenCount === 0}>
                  <Link href={hiddenCount > 0 ? "/messages?hidden=1" : "#"} aria-disabled={hiddenCount === 0}>
                    <EyeOff className="size-4" />
                    <span>{t.hiddenMessages}</span>
                    {hiddenCount > 0 && (
                      <span className="ml-1 flex size-5 items-center justify-center rounded-full bg-zinc-100 text-xs font-medium text-zinc-600 dark:bg-muted dark:text-muted-foreground">
                        {hiddenCount}
                      </span>
                    )}
                  </Link>
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-6 lg:p-7">
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
                    <Link href="/">{t.browseListings}</Link>
                  </Button>
                </div>
              </section>
            ) : conversations.length > 0 ? (
              <section>
                <div className="space-y-3">
                  {conversations.map((conversation) => (
                    <ConversationListItem
                      key={conversation.id}
                      conversation={conversation}
                      dateValue={conversation.lastMessageAt || conversation.updatedAt}
                      showHidden={showHidden}
                    />
                  ))}
                </div>
              </section>
            ) : (
              <section className="flex min-h-[420px] items-center justify-center rounded-[2rem] border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-border dark:bg-muted/40">
                <div className="max-w-xl">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-background text-foreground shadow-sm">
                    {showHidden ? <EyeOff className="size-6" /> : <MessageSquare className="size-6" />}
                  </div>
                  <h2 className="mt-5 text-2xl font-semibold text-zinc-950 dark:text-foreground">
                    {showHidden ? t.noHiddenConversationsTitle : t.noConversationsTitle}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-zinc-500 dark:text-muted-foreground">
                    {showHidden ? t.noHiddenConversationsDescription : t.noConversationsDescription}
                  </p>
                  {showHidden ? (
                    <Button asChild variant="outline" className="mt-6">
                      <Link href="/messages">{t.backToMessages}</Link>
                    </Button>
                  ) : (
                    <Button asChild className="mt-6">
                      <Link href="/">{t.browseListings}</Link>
                    </Button>
                  )}
                </div>
              </section>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
