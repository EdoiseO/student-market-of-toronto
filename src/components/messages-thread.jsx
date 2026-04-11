"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EllipsisVertical,
  Flag,
  Paperclip,
  SendHorizontal,
  SmilePlus,
} from "lucide-react";
import { toast } from "sonner";

import { ProfileAvatar } from "@/components/profile-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { ReportSheet } from "@/components/report-sheet";
import { useLanguage } from "@/context/LanguageContext";
import {
  getListingMessagingUnavailableText,
  getListingMessagingUnavailableStatusFromError,
  isConversationUserStateTableMissing,
  isListingMessagingAvailable,
  isListingMessagingUnavailableError,
  MESSAGE_CONVERSATION_SELECT,
} from "@/lib/messages";
import { createClient } from "@/utils/supabase/client";

function formatPrice(price, language) {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Number(price ?? 0));
}

export function MessagesThread({ conversation, currentUserId, initialMessages }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const [messages, setMessages] = React.useState(initialMessages ?? []);
  const [draft, setDraft] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const [reportMessageTarget, setReportMessageTarget] = React.useState(null);
  const isMessagingAvailable = isListingMessagingAvailable(conversation.listing.status);
  const messagingUnavailableText = getListingMessagingUnavailableText(conversation.listing.status, t);
  const hasListingLink = Boolean(conversation.listing.slug);

  React.useEffect(() => {
    setMessages(initialMessages ?? []);
  }, [conversation.id, initialMessages]);

  React.useEffect(() => {
    let isMounted = true;

    async function markConversationRead() {
      if (!conversation.hasUnreadMessages) {
        return;
      }

      const { data, error } = await supabase.rpc("mark_conversation_read", {
        p_conversation_id: conversation.id,
      });

      if (error) {
        console.error("Failed to mark conversation read:", error.message);
        return;
      }

      if (!isMounted) {
        return;
      }

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.sender_id === currentUserId || message.read_at
            ? message
            : {
                ...message,
                read_at: new Date().toISOString(),
              }
        )
      );

      if (Number(data ?? 0) > 0) {
        router.refresh();
      }
    }

    markConversationRead();

    return () => {
      isMounted = false;
    };
  }, [conversation.hasUnreadMessages, conversation.id, currentUserId, router, supabase]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!draft.trim()) {
      return;
    }

    if (!isMessagingAvailable) {
      toast.error(messagingUnavailableText);
      return;
    }

    setIsSending(true);

    const { data: conversationRow, error: conversationStatusError } = await supabase
      .from("conversations")
      .select(MESSAGE_CONVERSATION_SELECT)
      .eq("id", conversation.id)
      .maybeSingle();

    if (conversationStatusError) {
      console.error(
        "Failed to refresh conversation listing status before send:",
        conversationStatusError.message,
      );
    } else {
      const listing = Array.isArray(conversationRow?.listings)
        ? conversationRow.listings[0]
        : conversationRow?.listings;
      const latestListingStatus = listing?.status ?? null;

      if (!isListingMessagingAvailable(latestListingStatus) || !listing) {
        setIsSending(false);
        toast.error(getListingMessagingUnavailableText(latestListingStatus, t));
        return;
      }
    }

    const { data, error } = await supabase.rpc("send_conversation_message", {
      p_conversation_id: conversation.id,
      p_body: draft,
    });

    setIsSending(false);

    if (error) {
      toast.error(
        isListingMessagingUnavailableError(error)
          ? getListingMessagingUnavailableText(
              getListingMessagingUnavailableStatusFromError(error),
              t,
            )
          : t.messageSendError,
      );
      console.error("Failed to send message:", error.message);
      return;
    }

    const createdMessage = Array.isArray(data) ? data[0] : data;

    if (createdMessage) {
      setMessages((currentMessages) => [...currentMessages, createdMessage]);
    }

    const { error: unhideError } = await supabase.from("conversation_user_state").upsert(
      {
        conversation_id: conversation.id,
        user_id: currentUserId,
        hidden_at: null,
      },
      { onConflict: "conversation_id,user_id" },
    );

    if (unhideError && !isConversationUserStateTableMissing(unhideError)) {
      console.error("Failed to restore hidden conversation after send:", unhideError.message);
    }

    setDraft("");
    router.refresh();
  }

  function handleComposerKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    if (!draft.trim() || isSending) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  async function handleReportMessage(message) {
    setReportMessageTarget(message);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
      <div className="border-b border-zinc-200 p-6 dark:border-border">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {hasListingLink ? (
            <Link
              href={`/listings/${conversation.listing.slug}`}
              className="block rounded-2xl bg-zinc-50 p-4 transition hover:bg-background dark:bg-muted/40 dark:hover:bg-background lg:w-full lg:max-w-md"
            >
              <div className="flex items-center gap-4">
                <div className="h-18 w-18 shrink-0 overflow-hidden rounded-2xl bg-zinc-100 dark:bg-muted">
                  {conversation.listing.imageUrl ? (
                    <img
                      src={conversation.listing.imageUrl}
                      alt={conversation.listing.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-zinc-950 dark:text-foreground">
                    {conversation.listing.title}
                  </p>
                  <p className="mt-1 truncate text-sm font-medium text-zinc-900 dark:text-foreground">
                    {formatPrice(conversation.listing.price, language)}
                  </p>
                  <p className="mt-1 truncate text-sm text-zinc-500 dark:text-muted-foreground">
                    {conversation.listing.location || t.torontoMeetup}
                  </p>
                </div>
              </div>
            </Link>
          ) : (
            <div className="block rounded-2xl bg-zinc-50 p-4 dark:bg-muted/40 lg:w-full lg:max-w-md">
              <div className="flex items-center gap-4">
                <div className="h-18 w-18 shrink-0 overflow-hidden rounded-2xl bg-zinc-100 dark:bg-muted">
                  <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-zinc-950 dark:text-foreground">
                    {t.deletedListingTitle}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                    {t.deletedListingDescription}
                  </p>
                </div>
              </div>
            </div>
          )}

          {conversation.otherParticipant.id ? (
            <Link
              href={`/profile/${conversation.otherParticipant.id}`}
              className="flex items-center gap-3 rounded-xl transition hover:bg-zinc-50/80 dark:hover:bg-muted/40 lg:self-center"
            >
              <ProfileAvatar
                name={conversation.otherParticipant.name}
                avatarPresetId={conversation.otherParticipant.avatarPresetId}
                avatarUrl={conversation.otherParticipant.avatarUrl}
                className="size-10 border border-zinc-200 dark:border-border"
              />

              <div>
                <h1 className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                  {conversation.otherParticipant.name}
                </h1>
                <p className="text-xs text-zinc-500 dark:text-muted-foreground">
                  {conversation.otherParticipant.school || t.torontoStudent}
                </p>
              </div>
            </Link>
          ) : (
            <div className="flex items-center gap-3 lg:self-center">
              <ProfileAvatar
                name={conversation.otherParticipant.name}
                avatarPresetId={conversation.otherParticipant.avatarPresetId}
                avatarUrl={conversation.otherParticipant.avatarUrl}
                className="size-10 border border-zinc-200 dark:border-border"
              />

              <div>
                <h1 className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                  {conversation.otherParticipant.name}
                </h1>
                <p className="text-xs text-zinc-500 dark:text-muted-foreground">
                  {conversation.otherParticipant.school || t.torontoStudent}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-zinc-50/70 px-6 pt-3 pb-6 dark:bg-muted/20">
        {messages.length > 0 ? (
          messages.map((message) => {
            const isCurrentUser = message.sender_id === currentUserId;
            const participant = isCurrentUser
              ? conversation.currentParticipant
              : conversation.otherParticipant;

            return (
              <div
                key={message.id}
                className={`group/message flex items-end gap-3 ${isCurrentUser ? "flex-row-reverse" : ""}`}
              >
                <ProfileAvatar
                  name={participant.name}
                  avatarPresetId={participant.avatarPresetId}
                  avatarUrl={participant.avatarUrl}
                  className="size-10 border border-zinc-200 shadow-sm dark:border-border"
                />

                <div
                  className={`relative flex max-w-[85%] flex-col gap-1.5 sm:max-w-[70%] ${
                    isCurrentUser ? "items-end" : "items-start"
                  }`}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={t.moreActions}
                        className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-full border-zinc-300 bg-white text-zinc-700 opacity-0 shadow-sm transition group-hover/message:opacity-100 group-focus-within/message:opacity-100 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted ${
                          isCurrentUser ? "right-full mr-2" : "left-full ml-2"
                        }`}
                      >
                        <EllipsisVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align={isCurrentUser ? "start" : "end"}
                      className="w-44 rounded-2xl"
                    >
                      <DropdownMenuItem onClick={() => handleReportMessage(message)}>
                        <Flag className="size-4" />
                        <span>{t.reportMessage}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <p
                    className={`px-1 text-xs ${
                      isCurrentUser
                        ? "text-zinc-500 dark:text-muted-foreground"
                        : "text-zinc-500 dark:text-muted-foreground"
                    }`}
                  >
                    <span className="font-semibold text-zinc-900 dark:text-foreground">
                      {isCurrentUser ? t.you : participant.name}
                    </span>{" "}
                    <ClientFormattedDateTime value={message.created_at} language={language} />
                  </p>

                  <div
                    className={`w-fit rounded-[1.5rem] px-4 py-3 text-left shadow-sm ${
                      isCurrentUser
                        ? "rounded-tr-md bg-primary text-primary-foreground"
                        : "rounded-tl-md border border-zinc-200 bg-white text-zinc-900 dark:border-border dark:bg-card dark:text-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {message.body}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full min-h-[280px] items-center justify-center rounded-[1.75rem] border border-dashed border-zinc-300 bg-white/80 p-8 text-center dark:border-border dark:bg-card/80">
            <div className="max-w-md">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                {t.noMessagesYetTitle}
              </h2>
              <p className="mt-2 text-sm text-zinc-500 dark:text-muted-foreground">
                {t.noMessagesYetDescription}
              </p>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-zinc-200 p-6 dark:border-border">
        <div className="rounded-[1.75rem] border border-zinc-200 bg-background p-3 shadow-sm dark:border-border dark:bg-background">
          {!isMessagingAvailable ? (
            <p className="px-2 pb-3 text-sm text-muted-foreground">{messagingUnavailableText}</p>
          ) : null}
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={t.messageInputPlaceholder}
            rows={2}
            className="min-h-16 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
            maxLength={2000}
            disabled={!isMessagingAvailable || isSending}
          />

          <div className="mt-2 flex items-center justify-between gap-3 border-t border-zinc-200 px-2 pt-3 dark:border-border">
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-full text-zinc-500 dark:text-muted-foreground"
                      disabled
                      aria-label={t.emojiPickerSoon}
                    >
                      <SmilePlus className="size-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {t.emojiPickerSoon}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-full text-zinc-500 dark:text-muted-foreground"
                      disabled
                      aria-label={t.attachmentsSoon}
                    >
                      <Paperclip className="size-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {t.attachmentsSoon}
                </TooltipContent>
              </Tooltip>

              <p className="text-xs text-zinc-500 dark:text-muted-foreground">
                {draft.trim().length}/2000
              </p>
            </div>

            <Button
              type="submit"
              disabled={!isMessagingAvailable || isSending || !draft.trim()}
              size="icon-lg"
              className="rounded-full"
              aria-label={isSending ? t.sendingMessage : t.sendMessage}
            >
              <SendHorizontal className="size-4.5" />
            </Button>
          </div>
        </div>
      </form>

      <ReportSheet
        open={Boolean(reportMessageTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setReportMessageTarget(null);
          }
        }}
        subjectType="message"
        subjectId={reportMessageTarget?.id ?? null}
        messageId={reportMessageTarget?.id ?? null}
        conversationId={conversation.id}
        currentUserId={currentUserId}
        reportedUserId={reportMessageTarget?.sender_id ?? null}
      />
    </section>
  );
}
