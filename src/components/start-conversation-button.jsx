"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { focusFirstInvalidField } from "@/lib/focus-first-invalid-field";
import {
  callMessageMutationWithReplay,
  createMessageSendOperationId,
  getMessageOperationOutcome,
} from "@/lib/message-send-idempotency.mjs";
import {
  countUnicodeCodePoints,
  validateMessageBody,
} from "@/lib/write-field-contracts.mjs";
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
  const [messageBodyError, setMessageBodyError] = React.useState("");
  const [isSendingFirstMessage, setIsSendingFirstMessage] = React.useState(false);
  const [unresolvedFirstMessageIntent, setUnresolvedFirstMessageIntent] = React.useState(null);
  const [isLoadingBlockState, setIsLoadingBlockState] = React.useState(
    Boolean(currentUserId && sellerId && currentUserId !== sellerId),
  );
  const isMessagingAvailable = isListingMessagingAvailable(listingStatus);
  const [blockState, setBlockState] = React.useState({
    blockedByCurrentUser: false,
    blockedCurrentUser: false,
    available: true,
  });
  const messagingBlockReason = getMessagingBlockReason(blockState, t);
  const formRef = React.useRef(null);
  const draftValidation = validateMessageBody(draft);
  const draftCharacterCount = countUnicodeCodePoints(draft);

  React.useEffect(() => {
    let isMounted = true;

    async function loadBlockState() {
      if (!currentUserId || !sellerId || currentUserId === sellerId) {
        setIsLoadingBlockState(false);
        return;
      }

      const nextBlockState = await getUserBlockState(supabase, currentUserId, sellerId);

      if (nextBlockState.error) {
        console.error("Failed to load listing message block state:", nextBlockState.error.message);
      }

      if (isMounted) {
        if (!nextBlockState.error) {
          setBlockState(nextBlockState);
        }
        setIsLoadingBlockState(false);
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

  if (isLoadingBlockState) {
    return <Skeleton aria-hidden="true" className={`h-11 min-w-32 rounded-xl ${className ?? ""}`} />;
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

  async function completeFirstMessageIntent(intent) {
    const { error: unhideError } = await supabase.from("conversation_user_state").upsert(
      {
        conversation_id: intent.conversationId,
        user_id: currentUserId,
        hidden_at: null,
      },
      { onConflict: "conversation_id,user_id" },
    );

    if (unhideError && !isConversationUserStateTableMissing(unhideError)) {
      console.error("Failed to restore hidden conversation after send:", unhideError.message);
    }

    setUnresolvedFirstMessageIntent(null);
    setDraft("");
    setMessageBodyError("");
    setIsComposerOpen(false);
    router.push(`/messages/${intent.conversationId}`);
  }

  async function abortFirstMessageIntent(intent, originalError) {
    const abortResult = await callMessageMutationWithReplay(() =>
      supabase.rpc("abort_message_send_operation", {
        p_operation_id: intent.operationId,
        p_conversation_id: intent.conversationId,
        p_body: intent.body,
        p_attachments: [],
      }),
    );

    if (abortResult.ambiguous || abortResult.error) {
      setUnresolvedFirstMessageIntent(intent);
      toast.error(t.messageSendError);
      console.error(
        "Failed to reconcile first message:",
        abortResult.error?.message ?? originalError?.message,
      );
      return false;
    }

    const outcome = getMessageOperationOutcome(abortResult.data);

    if (outcome.status === "completed") {
      await completeFirstMessageIntent(intent);
      return true;
    }

    const { error: cleanupError } = await supabase
      .from("conversations")
      .delete()
      .eq("id", intent.conversationId)
      .is("last_message_at", null);

    if (cleanupError) {
      console.error("Failed to clean up confirmed empty conversation:", cleanupError.message);
    }

    setUnresolvedFirstMessageIntent(null);
    toast.error(
      isListingMessagingUnavailableError(originalError)
        ? getListingMessagingUnavailableText(
            getListingMessagingUnavailableStatusFromError(originalError),
            t,
          )
        : t.messageSendError,
    );
    return false;
  }

  async function executeFirstMessageIntent(intent) {
    setIsSendingFirstMessage(true);
    const sendResult = await callMessageMutationWithReplay(() =>
      supabase.rpc("send_conversation_message_idempotent", {
        p_operation_id: intent.operationId,
        p_conversation_id: intent.conversationId,
        p_body: intent.body,
        p_attachments: [],
      }),
    );

    if (sendResult.ambiguous) {
      setUnresolvedFirstMessageIntent(intent);
      setIsSendingFirstMessage(false);
      toast.error(t.messageSendError);
      return;
    }

    if (sendResult.error) {
      await abortFirstMessageIntent(intent, sendResult.error);
      setIsSendingFirstMessage(false);
      return;
    }

    await completeFirstMessageIntent(intent);
    setIsSendingFirstMessage(false);
  }

  async function handleDiscardFirstMessageIntent() {
    if (!unresolvedFirstMessageIntent || isSendingFirstMessage) {
      return;
    }

    setIsSendingFirstMessage(true);
    await abortFirstMessageIntent(
      unresolvedFirstMessageIntent,
      new Error("First message send was cancelled."),
    );
    setIsSendingFirstMessage(false);
  }

  async function handleSendFirstMessage(event) {
    event.preventDefault();

    if (isSendingFirstMessage) {
      return;
    }

    if (unresolvedFirstMessageIntent) {
      await executeFirstMessageIntent(unresolvedFirstMessageIntent);
      return;
    }

    const bodyResult = validateMessageBody(draft);

    if (!bodyResult.ok) {
      setMessageBodyError(
        bodyResult.error === "too_long" ? t.messageBodyTooLong : "",
      );
      focusFirstInvalidField(formRef.current);
      return;
    }

    setMessageBodyError("");
    setIsSendingFirstMessage(true);
    const canMessageListing = await ensureListingMessagingAvailable();

    if (!canMessageListing) {
      setIsSendingFirstMessage(false);
      return;
    }

    const { data: conversationData, error: conversationError } = await supabase.rpc(
      "create_or_get_listing_conversation",
      { p_listing_id: listingId },
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

    const intent = {
      operationId: createMessageSendOperationId(),
      conversationId: conversation.id,
      body: bodyResult.value,
    };
    setIsSendingFirstMessage(false);
    await executeFirstMessageIntent(intent);
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

      <Sheet
        open={isComposerOpen}
        onOpenChange={(open) => {
          if (open || !unresolvedFirstMessageIntent) {
            setIsComposerOpen(open);
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <form ref={formRef} className="flex h-full flex-col" onSubmit={handleSendFirstMessage}>
            <div className="flex flex-1 flex-col gap-6 px-6 py-6">
              <SheetHeader className="gap-2 p-0 text-left">
                <SheetTitle>{t.firstMessageSheetTitle}</SheetTitle>
                <SheetDescription>{t.firstMessageSheetDescription}</SheetDescription>
                {listingTitle ? (
                  <p className="pt-1 text-sm font-medium text-foreground">{listingTitle}</p>
                ) : null}
              </SheetHeader>

              <div className="flex-1">
                <Textarea
                  id="first-message-body"
                  value={draft}
                  onChange={(event) => {
                    const nextDraft = event.target.value;
                    const nextValidation = validateMessageBody(nextDraft);
                    setDraft(nextDraft);
                    setMessageBodyError(
                      nextValidation.error === "too_long" ? t.messageBodyTooLong : "",
                    );
                  }}
                  placeholder={t.messageInputPlaceholder}
                  rows={6}
                  className="h-40 min-h-32 max-h-[min(40svh,20rem)] rounded-xl"
                  aria-invalid={Boolean(messageBodyError)}
                  aria-describedby="first-message-body-count first-message-body-error"
                  disabled={isSendingFirstMessage || Boolean(unresolvedFirstMessageIntent)}
                />
                <div className="mt-2 flex items-start justify-between gap-3 text-xs">
                  <p
                    id="first-message-body-error"
                    role={messageBodyError ? "alert" : undefined}
                    className="min-h-4 text-red-600 dark:text-red-400"
                  >
                    {messageBodyError}
                  </p>
                  <p id="first-message-body-count" className="shrink-0 text-muted-foreground">
                    {t.messageBodyCharacterCount.replace(
                      "{count}",
                      String(draftCharacterCount),
                    )}
                  </p>
                </div>
              </div>
            </div>

            <SheetFooter className="border-t px-6 py-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  if (unresolvedFirstMessageIntent) {
                    void handleDiscardFirstMessageIntent();
                  } else {
                    setIsComposerOpen(false);
                  }
                }}
                disabled={isSendingFirstMessage}
              >
                {t.cancel}
              </Button>
              <Button
                type="submit"
                className="rounded-xl"
                disabled={
                  isSendingFirstMessage ||
                  (!unresolvedFirstMessageIntent && !draftValidation.ok)
                }
              >
                {isSendingFirstMessage
                  ? t.sendingMessage
                  : unresolvedFirstMessageIntent
                    ? t.retry
                    : t.sendFirstMessage}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
