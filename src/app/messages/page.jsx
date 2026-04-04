import { MessageSquare } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileAvatar } from "@/components/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MESSAGE_CONVERSATION_SELECT,
  normalizeConversationRow,
} from "@/lib/messages";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

function formatConversationDate(dateString, language) {
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    day: "numeric",
  }).format(new Date(dateString));
}

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

  const { data: conversationRows, error: conversationsError } = await supabase
    .from("conversations")
    .select(MESSAGE_CONVERSATION_SELECT)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order("updated_at", { ascending: false });

  if (conversationsError) {
    console.error("Failed to load conversations:", conversationsError.message);
  }

  const hasMessagingSetupError = Boolean(conversationsError);

  const conversationIds = (conversationRows ?? []).map((conversation) => conversation.id);

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

  const conversations = (conversationRows ?? []).map((conversation) =>
    normalizeConversationRow(
      conversation,
      user.id,
      t,
      unreadCountByConversationId[conversation.id] ?? 0,
    )
  );

  return (
    <main className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-7">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6">
        <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:border-border dark:bg-card">
          <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border lg:px-7">
            <CardTitle className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-foreground lg:text-4xl">
              {t.messages}
            </CardTitle>
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
                    <Link
                      key={conversation.id}
                      href={`/messages/${conversation.id}`}
                      className="block rounded-[1.5rem] border border-zinc-200 bg-white p-4 transition hover:bg-background dark:border-border dark:bg-card dark:hover:bg-background"
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-muted">
                          {conversation.listing.imageUrl ? (
                            <img
                              src={conversation.listing.imageUrl}
                              alt={conversation.listing.title}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                          )}

                          <div className="absolute -top-1 -right-1 rounded-full bg-white p-0.5 shadow-sm dark:bg-card">
                            <ProfileAvatar
                              name={conversation.otherParticipant.name}
                              avatarPresetId={conversation.otherParticipant.avatarPresetId}
                              avatarUrl={conversation.otherParticipant.avatarUrl}
                              className="size-7 border border-zinc-200 dark:border-border"
                            />
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-zinc-950 dark:text-foreground">
                                {conversation.listing.title}
                              </p>
                              <p className="truncate text-sm text-zinc-500 dark:text-muted-foreground">
                                {conversation.otherParticipant.name}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {conversation.unreadCount > 0 ? (
                                <Badge className="rounded-full px-2.5 py-0.5">
                                  {conversation.unreadCount}
                                </Badge>
                              ) : null}
                              <span className="text-xs text-zinc-500 dark:text-muted-foreground">
                                {formatConversationDate(
                                  conversation.lastMessageAt || conversation.updatedAt,
                                  language,
                                )}
                              </span>
                            </div>
                          </div>

                          <p className="mt-3 line-clamp-2 text-sm text-zinc-600 dark:text-muted-foreground">
                            {conversation.lastMessagePreview || t.conversationNoMessagesYet}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ) : (
              <section className="flex min-h-[420px] items-center justify-center rounded-[2rem] border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-border dark:bg-muted/40">
                <div className="max-w-xl">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-background text-foreground shadow-sm">
                    <MessageSquare className="size-6" />
                  </div>
                  <h2 className="mt-5 text-2xl font-semibold text-zinc-950 dark:text-foreground">
                    {t.noConversationsTitle}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-zinc-500 dark:text-muted-foreground">
                    {t.noConversationsDescription}
                  </p>
                  <Button asChild className="mt-6">
                    <Link href="/">{t.browseListings}</Link>
                  </Button>
                </div>
              </section>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
