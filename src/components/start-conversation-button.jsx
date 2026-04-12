"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  isConversationHiddenForUser,
  getListingMessagingUnavailableText,
  getListingMessagingUnavailableStatusFromError,
  isConversationInboxVisibleForUser,
  isConversationUserStateDeletedAtColumnMissing,
  isConversationUserStateTableMissing,
  isListingMessagingAvailable,
  isListingMessagingUnavailableError,
} from "@/lib/messages";
import { getMessagingBlockReason, getUserBlockState } from "@/lib/blocks";
import { createClient } from "@/utils/supabase/client";

export function StartConversationButton({
  listingId,
  listingTitle,
  listingStatus,
  sellerId,
  currentUserId,
  className,
}) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t } = useLanguage();
  const [isStarting, setIsStarting] = React.useState(false);
  const [isComposerOpen, setIsComposerOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [isSendingFirstMessage, setIsSendingFirstMessage] = React.useState(false);
  const isMessagingAvailable = isListingMessagingAvailable(listingStatus);
  const [blockState, setBlockState] = React.useState({
    blockedByCurrentUser: false,
    blockedCurrentUser: false,
    available: true,
  });
  const messagingBlockReason = getMessagingBlockReason(blockState, t);

  React.useEffect(() => {
    let isMounted = true;

    async function loadBlockState() {
      if (!currentUserId || !sellerId || currentUserId === sellerId) {
        return;
      }

      const nextBlockState = await getUserBlockState(supabase, currentUserId, sellerId);

      if (nextBlockState.error) {
        console.error("Failed to load listing message block state:", nextBlockState.error.message);
        return;
      }

      if (isMounted) {
        setBlockState(nextBlockState);
      }
    }

    loadBlockState();

    return () => {
      isMounted = false;
    };
  }, [currentUserId, sellerId, supabase]);

  async function getLatestListingStatus() {
    const { data, error } = await supabase
      .from("listings")
      .select("status")
      .eq("id", listingId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load latest listing status for messaging:", error.message);
      return { status: listingStatus ?? null, hasError: true };
    }

    return { status: data?.status ?? null, hasError: false };
  }

  async function ensureListingMessagingAvailable() {
    const latestBlockState = await getUserBlockState(supabase, currentUserId, sellerId);

    if (latestBlockState.error) {
      console.error("Failed to refresh listing message block state:", latestBlockState.error.message);
    } else {
      setBlockState(latestBlockState);

      const latestBlockReason = getMessagingBlockReason(latestBlockState, t);

      if (latestBlockReason) {
        toast.error(latestBlockReason);
        return false;
      }
    }

    if (!isMessagingAvailable) {
      toast.error(getListingMessagingUnavailableText(listingStatus, t));
      return false;
    }

    const { status, hasError } = await getLatestListingStatus();

    if (!isListingMessagingAvailable(status) || (!hasError && !status)) {
      toast.error(getListingMessagingUnavailableText(status, t));
      return false;
    }

    return true;
  }

  if (currentUserId === sellerId) {
    return (
      <Button type="button" disabled className={className}>
        <MessageCircle className="size-4" />
        <span>{t.thisIsYourListing}</span>
      </Button>
    );
  }

  if (!isMessagingAvailable) {
    return (
      <Button type="button" disabled className={className}>
        <MessageCircle className="size-4" />
        <span>{t.messagingUnavailable}</span>
      </Button>
    );
  }

  if (messagingBlockReason) {
    return (
      <Button type="button" disabled className={className}>
        <MessageCircle className="size-4" />
        <span>{blockState.blockedByCurrentUser ? t.userBlocked : t.messagingUnavailable}</span>
      </Button>
    );
  }

  if (!currentUserId) {
    return (
      <Button asChild type="button" className={className}>
        <Link href="/login">
          <MessageCircle className="size-4" />
          <span>{t.signInToMessageSeller}</span>
        </Link>
      </Button>
    );
  }

  async function handleStartConversation() {
    if (isStarting) {
      return;
    }

    setIsStarting(true);

    const canMessageListing = await ensureListingMessagingAvailable();

    if (!canMessageListing) {
      setIsStarting(false);
      return;
    }

    const { data, error } = await supabase
      .from("conversations")
      .select("id, last_message_at, last_message_preview")
      .eq("listing_id", listingId)
      .eq("buyer_id", currentUserId)
      .eq("seller_id", sellerId)
      .maybeSingle();

    setIsStarting(false);

    if (error) {
      toast.error(t.conversationStartError);
      console.error("Failed to look up existing conversation:", error.message);
      return;
    }

    if (data?.id && (data.last_message_at || data.last_message_preview)) {
      let conversationStateRow = null;

      const { data: conversationStateWithDelete, error: conversationStateError } = await supabase
        .from("conversation_user_state")
        .select("hidden_at, deleted_at")
        .eq("conversation_id", data.id)
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (
        conversationStateError &&
        isConversationUserStateDeletedAtColumnMissing(conversationStateError)
      ) {
        const { data: fallbackConversationState, error: fallbackConversationStateError } =
          await supabase
            .from("conversation_user_state")
            .select("hidden_at")
            .eq("conversation_id", data.id)
            .eq("user_id", currentUserId)
            .maybeSingle();

        if (
          fallbackConversationStateError &&
          !isConversationUserStateTableMissing(fallbackConversationStateError)
        ) {
          console.error(
            "Failed to load existing conversation state:",
            fallbackConversationStateError.message,
          );
        } else {
          conversationStateRow = fallbackConversationState
            ? { ...fallbackConversationState, deleted_at: null }
            : null;
        }
      } else {
        conversationStateRow = conversationStateWithDelete;
      }

      if (conversationStateError && !isConversationUserStateTableMissing(conversationStateError)) {
        if (!isConversationUserStateDeletedAtColumnMissing(conversationStateError)) {
          console.error(
            "Failed to load existing conversation state:",
            conversationStateError.message,
          );
        }
      }

      const isHiddenConversation = isConversationHiddenForUser(
        data,
        conversationStateRow?.hidden_at,
        conversationStateRow?.deleted_at,
      );

      const isConversationVisible = isConversationInboxVisibleForUser(
        data,
        conversationStateRow?.hidden_at,
        conversationStateRow?.deleted_at,
      );

      if (isHiddenConversation) {
        const { error: unhideError } = await supabase.from("conversation_user_state").upsert(
          {
            conversation_id: data.id,
            user_id: currentUserId,
            hidden_at: null,
          },
          { onConflict: "conversation_id,user_id" },
        );

        if (unhideError && !isConversationUserStateTableMissing(unhideError)) {
          console.error("Failed to restore hidden conversation:", unhideError.message);
        }

        router.push(`/messages/${data.id}`);
        return;
      }

      if (isConversationVisible) {
        router.push(`/messages/${data.id}`);
        return;
      }
    }

    setIsComposerOpen(true);
  }

  async function handleSendFirstMessage(event) {
    event.preventDefault();

    if (!draft.trim() || isSendingFirstMessage) {
      return;
    }

    setIsSendingFirstMessage(true);

    const canMessageListing = await ensureListingMessagingAvailable();

    if (!canMessageListing) {
      setIsSendingFirstMessage(false);
      return;
    }

    const body = draft.trim();
    const { data: conversationData, error: conversationError } = await supabase.rpc(
      "create_or_get_listing_conversation",
      {
        p_listing_id: listingId,
      },
    );

    const conversation = Array.isArray(conversationData) ? conversationData[0] : conversationData;

    if (conversationError || !conversation?.id) {
      setIsSendingFirstMessage(false);
      toast.error(
        isListingMessagingUnavailableError(conversationError)
          ? getListingMessagingUnavailableText(
              getListingMessagingUnavailableStatusFromError(conversationError),
              t,
            )
          : t.conversationStartError,
      );
      console.error(
        "Failed to create or load conversation for first message:",
        conversationError?.message,
      );
      return;
    }

    const { error: sendError } = await supabase.rpc("send_conversation_message", {
      p_conversation_id: conversation.id,
      p_body: body,
    });

    if (sendError) {
      const { error: cleanupError } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversation.id)
        .is("last_message_at", null);

      if (cleanupError) {
        console.error("Failed to clean up empty conversation:", cleanupError.message);
      }

      setIsSendingFirstMessage(false);
      toast.error(
        isListingMessagingUnavailableError(sendError)
          ? getListingMessagingUnavailableText(
              getListingMessagingUnavailableStatusFromError(sendError),
              t,
            )
          : t.messageSendError,
      );
      console.error("Failed to send first message:", sendError.message);
      return;
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

    setIsSendingFirstMessage(false);
    setDraft("");
    setIsComposerOpen(false);
    router.push(`/messages/${conversation.id}`);
  }

  return (
    <>
      <Button
        type="button"
        className={className}
        onClick={handleStartConversation}
        disabled={isStarting}
      >
        <MessageCircle className="size-4" />
        <span>{isStarting ? t.startingConversation : t.chatWithSeller}</span>
      </Button>

      <Sheet open={isComposerOpen} onOpenChange={setIsComposerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <form className="flex h-full flex-col" onSubmit={handleSendFirstMessage}>
            <div className="flex flex-1 flex-col gap-6 px-6 py-6">
              <SheetHeader className="gap-2 p-0 text-left">
                <SheetTitle>{t.firstMessageSheetTitle}</SheetTitle>
                <SheetDescription>{t.firstMessageSheetDescription}</SheetDescription>
                {listingTitle ? (
                  <p className="pt-1 text-sm font-medium text-foreground">{listingTitle}</p>
                ) : null}
              </SheetHeader>

              <div className="flex-1">
                <textarea
                  data-slot="textarea"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t.messageInputPlaceholder}
                  rows={10}
                  maxLength={2000}
                  className="min-h-16 w-full resize-none rounded-xl border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30"
                />
              </div>
            </div>

            <SheetFooter className="border-t px-6 py-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => setIsComposerOpen(false)}
                disabled={isSendingFirstMessage}
              >
                {t.cancel}
              </Button>
              <Button
                type="submit"
                className="rounded-xl"
                disabled={isSendingFirstMessage || !draft.trim()}
              >
                {isSendingFirstMessage ? t.sendingMessage : t.sendFirstMessage}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
