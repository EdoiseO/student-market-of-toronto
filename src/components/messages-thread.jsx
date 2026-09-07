"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EllipsisVertical,
  Eye,
  EyeOff,
  Flag,
  LifeBuoy,
  LockKeyhole,
  Megaphone,
  Paperclip,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ProfileAvatar } from "@/components/profile-avatar";
import { MessageEmojiPicker } from "@/components/message-emoji-picker";
import { MessageReactions } from "@/components/message-reactions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { MessageMediaGallery } from "@/components/message-media-gallery";
import { ReportSheet } from "@/components/report-sheet";
import { useLanguage } from "@/context/LanguageContext";
import { useFileDropzone } from "@/hooks/use-file-dropzone";
import {
  CONVERSATION_MODERATION_STATE_SELECT,
  getConversationClosureExpiryDelay,
  isConversationClosedWriteError,
  isConversationEffectivelyClosed,
  normalizeConversationModerationState,
} from "@/lib/conversation-moderation.mjs";
import { withPrivateMessageMediaUrl } from "@/lib/private-message-media.mjs";
import { REMOTE_IMAGE_BLUR_DATA_URL } from "@/lib/image-config";
import {
  getMessagingBlockReason,
  getUserBlockState,
  isBlockedUsersTableMissing,
} from "@/lib/blocks";
import {
  getListingMessagingUnavailableText,
  getListingMessagingUnavailableStatusFromError,
  isConversationUserStateDeletedAtColumnMissing,
  isConversationUserStateTableMissing,
  isListingMessagingAvailable,
  isListingMessagingUnavailableError,
  isMessageAttachmentSetupMissing,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENTS,
  MESSAGE_ATTACHMENT_ACCEPT,
  MESSAGE_ATTACHMENT_MIME_TYPES,
  MESSAGE_CONVERSATION_SELECT,
  MESSAGE_MEDIA_BUCKET,
  sanitizeMessageAttachmentFileName,
} from "@/lib/messages";
import { selectMessageAttachmentFiles } from "@/lib/message-attachment-selection.mjs";
import { insertMessageEmoji } from "@/lib/message-emojis.mjs";
import {
  keepNewestMessageWindow,
  mergeOlderMessageWindow,
  MESSAGE_PAGE_REQUEST_LIMIT,
  normalizeMessagePageRows,
} from "@/lib/message-pagination.mjs";
import {
  buildMessageMediaUploadPlan,
  cleanupExpiredMessageMediaUploads,
  releaseMessageMediaUploadReservations,
  reserveMessageMediaUploadsIdempotent,
} from "@/lib/message-media-reservations.mjs";
import {
  callMessageMutationWithReplay,
  createMessageSendOperationId,
  getMessageOperationOutcome,
  isStorageObjectAlreadyPresent,
} from "@/lib/message-send-idempotency.mjs";
import {
  addMessageReaction,
  applyMessageReactionChange,
  removeMessageReaction,
  replaceMessageReactions,
  subscribeToMessageReactionUpdates,
} from "@/lib/message-reactions.mjs";
import { subscribeToConversationMessageInserts } from "@/lib/message-realtime.mjs";
import { subscribeToNotificationUpdates } from "@/lib/notification-realtime.mjs";
import { focusFirstInvalidField } from "@/lib/focus-first-invalid-field";
import {
  MESSAGE_BODY_MAX_LENGTH,
  countUnicodeCodePoints,
  validateMessageBody,
} from "@/lib/write-field-contracts.mjs";
import { createClient } from "@/utils/supabase/client";

function formatPrice(price, language) {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Number(price ?? 0));
}

function formatAttachmentSize(bytes, language) {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "unit",
    unit: bytes >= 1024 * 1024 ? "megabyte" : "kilobyte",
    maximumFractionDigits: 1,
  }).format(bytes / (bytes >= 1024 * 1024 ? 1024 * 1024 : 1024));
}

function getAttachmentKind(mimeType) {
  return mimeType?.startsWith("video/") ? "video" : "image";
}

function isGroupedWithPreviousMessage(message, previousMessage) {
  if (!previousMessage || message.sender_id !== previousMessage.sender_id) {
    return false;
  }

  const currentTimestamp = new Date(message.created_at).getTime();
  const previousTimestamp = new Date(previousMessage.created_at).getTime();

  return (
    Number.isFinite(currentTimestamp) &&
    Number.isFinite(previousTimestamp) &&
    currentTimestamp - previousTimestamp <= 5 * 60 * 1000
  );
}

function upsertConversationMessage(currentMessages, incomingMessage) {
  const existingIndex = currentMessages.findIndex(
    (message) => message.id === incomingMessage.id,
  );

  if (existingIndex === -1) {
    return keepNewestMessageWindow([...currentMessages, incomingMessage]);
  }

  const existingMessage = currentMessages[existingIndex];
  const nextMessages = [...currentMessages];
  nextMessages[existingIndex] = {
    ...existingMessage,
    ...incomingMessage,
    attachments: incomingMessage.attachments?.length
      ? incomingMessage.attachments
      : existingMessage.attachments ?? [],
    reactions: existingMessage.reactions ?? incomingMessage.reactions ?? [],
  };
  return keepNewestMessageWindow(nextMessages);
}

export function MessagesThread({
  conversation,
  currentUserId,
  initialMessages,
  initialHasOlderMessages = false,
  initialModerationState = null,
  hasDeletedMessages = false,
  isHiddenConversation = false,
}) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const [messages, setMessages] = React.useState(initialMessages ?? []);
  const [hasOlderMessages, setHasOlderMessages] = React.useState(initialHasOlderMessages);
  const [hasNewerMessages, setHasNewerMessages] = React.useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false);
  const hasNewerMessagesRef = React.useRef(false);
  const [pendingReactionKeys, setPendingReactionKeys] = React.useState(() => new Set());
  const [draft, setDraft] = React.useState("");
  const [messageBodyError, setMessageBodyError] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const [unresolvedSendIntent, setUnresolvedSendIntent] = React.useState(null);
  const [pendingAttachments, setPendingAttachments] = React.useState([]);
  const pendingAttachmentsRef = React.useRef([]);
  const composerRef = React.useRef(null);
  const composerFormRef = React.useRef(null);
  const composerSelectionRef = React.useRef({ start: 0, end: 0 });
  const mediaInputRef = React.useRef(null);
  const [reportMessageTarget, setReportMessageTarget] = React.useState(null);
  const [blockState, setBlockState] = React.useState({
    blockedByCurrentUser: false,
    blockedCurrentUser: false,
    available: true,
  });
  const [moderationState, setModerationState] = React.useState(initialModerationState);
  const moderationStateRef = React.useRef(initialModerationState);
  const [moderationLiveStatus, setModerationLiveStatus] = React.useState("");
  const isAnnouncementConversation = Boolean(conversation.isAnnouncement);
  const isConversationClosed =
    !isAnnouncementConversation && isConversationEffectivelyClosed(moderationState);
  const isMessagingAvailable =
    !isAnnouncementConversation && isListingMessagingAvailable(conversation.listing.status);
  const [isHideDialogOpen, setIsHideDialogOpen] = React.useState(false);
  const [isHiding, setIsHiding] = React.useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [isDeletingConversation, setIsDeletingConversation] = React.useState(false);
  const [isBlockDialogOpen, setIsBlockDialogOpen] = React.useState(false);
  const [isUpdatingBlockState, setIsUpdatingBlockState] = React.useState(false);

  async function hydrateMessageRows(messageRows) {
    const messageIds = messageRows.map((message) => message.id);

    if (messageIds.length === 0) {
      return [];
    }

    const [attachmentsResult, reactionsResult] = await Promise.all([
      supabase
        .from("message_attachments")
        .select("id, message_id, storage_path, file_name, mime_type, size_bytes, created_at")
        .in("message_id", messageIds)
        .order("created_at", { ascending: true }),
      supabase
        .from("message_reactions")
        .select("message_id, conversation_id, user_id, emoji, created_at, removed_at")
        .in("message_id", messageIds)
        .is("removed_at", null)
        .order("created_at", { ascending: true }),
    ]);

    if (attachmentsResult.error && !isMessageAttachmentSetupMissing(attachmentsResult.error)) {
      throw attachmentsResult.error;
    }

    if (reactionsResult.error && !isMessageAttachmentSetupMissing(reactionsResult.error)) {
      throw reactionsResult.error;
    }

    const attachmentRows = attachmentsResult.data ?? [];
    const attachmentsByMessageId = attachmentRows.reduce((byMessageId, attachment) => {
      byMessageId[attachment.message_id] ??= [];
      byMessageId[attachment.message_id].push(withPrivateMessageMediaUrl(attachment));
      return byMessageId;
    }, {});
    const reactionsByMessageId = (reactionsResult.data ?? []).reduce((byMessageId, reaction) => {
      byMessageId[reaction.message_id] ??= [];
      byMessageId[reaction.message_id].push(reaction);
      return byMessageId;
    }, {});

    return messageRows.map((message) => ({
      ...message,
      attachments: attachmentsByMessageId[message.id] ?? [],
      reactions: reactionsByMessageId[message.id] ?? [],
    }));
  }

  async function fetchMessagePage(beforeMessage = null) {
    const { data, error } = await supabase.rpc("get_conversation_message_page", {
      p_conversation_id: conversation.id,
      p_before_created_at: beforeMessage?.created_at ?? null,
      p_before_message_id: beforeMessage?.id ?? null,
      p_limit: MESSAGE_PAGE_REQUEST_LIMIT,
    });

    if (error) {
      throw error;
    }

    const page = normalizeMessagePageRows(data ?? []);
    return {
      ...page,
      messages: await hydrateMessageRows(page.messages),
    };
  }

  async function handleLoadOlderMessages() {
    if (isLoadingHistory || !hasOlderMessages || messages.length === 0) {
      return;
    }

    setIsLoadingHistory(true);

    try {
      const page = await fetchMessagePage(messages[0]);
      const nextWindow = mergeOlderMessageWindow(messages, page.messages);
      setMessages(nextWindow.messages);
      setHasOlderMessages(page.hasOlderMessages);

      if (nextWindow.droppedNewerMessages) {
        hasNewerMessagesRef.current = true;
        setHasNewerMessages(true);
      }
    } catch (error) {
      console.error("Failed to load older conversation messages:", error?.message ?? error);
      toast.error(t.messageHistoryLoadError);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function handleReturnToNewestMessages() {
    if (isLoadingHistory || !hasNewerMessages) {
      return;
    }

    setIsLoadingHistory(true);

    try {
      const page = await fetchMessagePage();
      setMessages(page.messages);
      setHasOlderMessages(page.hasOlderMessages);
      hasNewerMessagesRef.current = false;
      setHasNewerMessages(false);
    } catch (error) {
      console.error("Failed to load newest conversation messages:", error?.message ?? error);
      toast.error(t.messageHistoryLoadError);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function handleUpdateBlockState() {
    if (isUpdatingBlockState) {
      return;
    }

    setIsUpdatingBlockState(true);

    const isBlocking = !blockState.blockedByCurrentUser;
    const operation = isBlocking
      ? supabase.from("blocked_users").insert({
          blocker_user_id: currentUserId,
          blocked_user_id: conversation.otherParticipant.id,
        })
      : supabase
          .from("blocked_users")
          .delete()
          .eq("blocker_user_id", currentUserId)
          .eq("blocked_user_id", conversation.otherParticipant.id);

    const { error } = await operation;

    if (error) {
      if (isBlockedUsersTableMissing(error)) {
        toast.error(t.blockUserUnavailable);
      } else {
        console.error("Failed to update block state:", error.message);
        toast.error(t.blockUserError);
      }
      setIsUpdatingBlockState(false);
      return;
    }

    const nextBlockState = await getUserBlockState(
      supabase,
      currentUserId,
      conversation.otherParticipant.id,
    );

    if (!nextBlockState.error) {
      setBlockState(nextBlockState);
    }

    setIsUpdatingBlockState(false);
    setIsBlockDialogOpen(false);
    toast.success(isBlocking ? t.blockUserSuccess : t.unblockUserSuccess);
  }

  async function handleHideConversation() {
    if (isHiding) return;
    setIsHiding(true);

    const { error } = await supabase.from("conversation_user_state").upsert(
      {
        conversation_id: conversation.id,
        user_id: currentUserId,
        hidden_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id,user_id" },
    );

    if (error && !isConversationUserStateTableMissing(error)) {
      console.error("Failed to hide conversation:", error.message);
      toast.error(t.hideConversationError);
      setIsHiding(false);
      return;
    }

    setIsHiding(false);
    setIsHideDialogOpen(false);
    router.push("/messages");
    router.refresh();
  }

  async function handleRestoreConversation() {
    if (isHiding) return;
    setIsHiding(true);

    const { error } = await supabase.from("conversation_user_state").upsert(
      {
        conversation_id: conversation.id,
        user_id: currentUserId,
        hidden_at: null,
      },
      { onConflict: "conversation_id,user_id" },
    );

    if (error && !isConversationUserStateTableMissing(error)) {
      console.error("Failed to restore conversation:", error.message);
      toast.error(t.restoreConversationError);
      setIsHiding(false);
      return;
    }

    setIsHiding(false);
    setIsHideDialogOpen(false);
    router.refresh();
  }

  async function handleDeleteConversation() {
    if (isDeletingConversation) return;
    setIsDeletingConversation(true);

    const { error } = await supabase.from("conversation_user_state").upsert(
      {
        conversation_id: conversation.id,
        user_id: currentUserId,
        deleted_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id,user_id" },
    );

    if (error) {
      if (isConversationUserStateDeletedAtColumnMissing(error)) {
        toast.error(t.deleteConversationSetupRequired);
        setIsDeletingConversation(false);
        return;
      }

      if (!isConversationUserStateTableMissing(error)) {
        console.error("Failed to delete conversation:", error.message);
        toast.error(t.deleteConversationError);
        setIsDeletingConversation(false);
        return;
      }
    }

    setIsDeletingConversation(false);
    setIsDeleteDialogOpen(false);
    router.push("/messages");
    router.refresh();
  }
  const messagingUnavailableText = isAnnouncementConversation
    ? t.announcementRepliesDisabled
    : getListingMessagingUnavailableText(conversation.listing.status, t);
  const blockReason = getMessagingBlockReason(blockState, t);
  const hasListingLink = Boolean(conversation.listing.slug);
  const isSendIntentLocked = Boolean(unresolvedSendIntent);
  const isMediaSelectionAvailable =
    isMessagingAvailable && !isConversationClosed && !blockReason && !isSending
    && !isSendIntentLocked;
  const draftValidation = validateMessageBody(draft, {
    allowEmpty: pendingAttachments.length > 0,
  });
  const draftCharacterCount = countUnicodeCodePoints(draft);
  const { isDragActive, dropzoneProps } = useFileDropzone(addPendingMediaFiles);

  React.useEffect(() => {
    setMessages(keepNewestMessageWindow(initialMessages ?? []));
    setHasOlderMessages(initialHasOlderMessages);
    setHasNewerMessages(false);
    hasNewerMessagesRef.current = false;
  }, [conversation.id, initialHasOlderMessages, initialMessages]);

  React.useEffect(() => {
    moderationStateRef.current = initialModerationState;
    setModerationState(initialModerationState);
    setModerationLiveStatus("");
  }, [conversation.id, initialModerationState]);

  const commitModerationState = React.useCallback((nextModerationState, announce = true) => {
    const wasClosed = moderationStateRef.current?.effectiveStatus === "closed";
    const isNowClosed = isConversationEffectivelyClosed(nextModerationState);

    moderationStateRef.current = nextModerationState;
    setModerationState(nextModerationState);

    if (announce && wasClosed && !isNowClosed) {
      setModerationLiveStatus(t.conversationReopenedLiveStatus);
    } else if (isNowClosed) {
      setModerationLiveStatus("");
    }
  }, [t.conversationReopenedLiveStatus]);

  const refreshConversationModerationState = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("conversation_effective_moderation_state")
      .select(CONVERSATION_MODERATION_STATE_SELECT)
      .eq("conversation_id", conversation.id)
      .maybeSingle();

    if (error) {
      console.error("Failed to refresh conversation moderation state:", error.message);
      toast.error(t.conversationModerationRefreshError);
      return null;
    }

    const nextModerationState = normalizeConversationModerationState(data);
    commitModerationState(nextModerationState);
    return nextModerationState;
  }, [commitModerationState, conversation.id, supabase, t.conversationModerationRefreshError]);

  React.useEffect(() => {
    if (isAnnouncementConversation) {
      return undefined;
    }

    return subscribeToNotificationUpdates({
      supabase,
      userId: currentUserId,
      channelName: `conversation-moderation-thread-${conversation.id}`,
      onChange: () => refreshConversationModerationState(),
    });
  }, [conversation.id, currentUserId, isAnnouncementConversation, refreshConversationModerationState, supabase]);

  React.useEffect(() => {
    const expiryDelay = getConversationClosureExpiryDelay(moderationState);

    if (expiryDelay === null) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      if (getConversationClosureExpiryDelay(moderationState) === 0) {
        commitModerationState(
          moderationState ? { ...moderationState, effectiveStatus: "open" } : null,
        );
        return;
      }

      setModerationState((currentState) => currentState ? { ...currentState } : currentState);
    }, Math.min(expiryDelay + 50, 2_147_000_000));

    return () => window.clearTimeout(timeoutId);
  }, [commitModerationState, moderationState]);

  React.useEffect(() =>
    subscribeToMessageReactionUpdates({
      supabase,
      conversationId: conversation.id,
      onInsert: (reaction) => {
        setMessages((currentMessages) => addMessageReaction(currentMessages, reaction));
      },
      onUpdate: (reaction) => {
        setMessages((currentMessages) => applyMessageReactionChange(currentMessages, reaction));
      },
    }),
  [conversation.id, supabase]);

  React.useEffect(() => {
    let isActive = true;

    const unsubscribe = subscribeToConversationMessageInserts({
      supabase,
      conversationId: conversation.id,
      onInsert: async (message) => {
        if (hasNewerMessagesRef.current) {
          setHasNewerMessages(true);
          return;
        }

        const { data: attachmentRows, error: attachmentsError } = await supabase
          .from("message_attachments")
          .select("id, message_id, storage_path, file_name, mime_type, size_bytes, created_at")
          .eq("message_id", message.id)
          .order("created_at", { ascending: true });

        if (!isActive) {
          return;
        }

        let attachments = [];

        if (attachmentsError) {
          if (!isMessageAttachmentSetupMissing(attachmentsError)) {
            console.error(
              "Failed to load incoming message attachments:",
              attachmentsError.message,
            );
          }
        } else if (attachmentRows?.length) {
          attachments = attachmentRows.map(withPrivateMessageMediaUrl);
        }

        if (!isActive) {
          return;
        }

        setMessages((currentMessages) =>
          upsertConversationMessage(currentMessages, {
            ...message,
            attachments,
            reactions: [],
          }),
        );

        if (message.sender_id === currentUserId) {
          return;
        }

        const { error: markReadError } = await supabase.rpc("mark_conversation_read", {
          p_conversation_id: conversation.id,
        });

        if (markReadError) {
          console.error("Failed to mark incoming message read:", markReadError.message);
          return;
        }

        if (isActive) {
          const readAt = new Date().toISOString();
          setMessages((currentMessages) =>
            currentMessages.map((currentMessage) =>
              currentMessage.sender_id === currentUserId || currentMessage.read_at
                ? currentMessage
                : { ...currentMessage, read_at: readAt },
            ),
          );
        }
      },
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [conversation.id, currentUserId, supabase]);

  React.useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  React.useEffect(() => {
    return () => {
      pendingAttachmentsRef.current.forEach((attachment) =>
        URL.revokeObjectURL(attachment.previewUrl),
      );
    };
  }, []);

  function clearPendingAttachments() {
    setPendingAttachments((currentAttachments) => {
      currentAttachments.forEach((attachment) =>
        URL.revokeObjectURL(attachment.previewUrl),
      );
      return [];
    });
  }

  function removePendingAttachment(attachmentId) {
    setPendingAttachments((currentAttachments) => {
      const attachment = currentAttachments.find((item) => item.id === attachmentId);

      if (attachment) {
        URL.revokeObjectURL(attachment.previewUrl);
      }

      return currentAttachments.filter((item) => item.id !== attachmentId);
    });
  }

  function addPendingMediaFiles(selectedFiles) {
    if (!isMediaSelectionAvailable) {
      return;
    }

    const selection = selectMessageAttachmentFiles({
      files: selectedFiles,
      currentAttachments: pendingAttachments,
      allowedMimeTypes: MESSAGE_ATTACHMENT_MIME_TYPES,
      maxBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
      maxCount: MAX_MESSAGE_ATTACHMENTS,
    });

    if (selection.limitExceeded) {
      toast.error(
        language === "fr"
          ? `Vous pouvez joindre jusqu’à ${MAX_MESSAGE_ATTACHMENTS} fichiers.`
          : `You can attach up to ${MAX_MESSAGE_ATTACHMENTS} files.`,
      );
    }

    if (selection.duplicateFiles.length > 0) {
      const duplicateName = selection.duplicateFiles[0]?.name ?? t.attachMedia;
      toast.error(
        t.duplicateMediaAttachment.replace("{name}", duplicateName),
      );
    }

    if (selection.unsupportedFiles.length > 0) {
      const unsupportedFile = selection.unsupportedFiles[0];
      toast.error(
        language === "fr"
          ? `${unsupportedFile.name} n’est pas un format d’image ou de vidéo pris en charge.`
          : `${unsupportedFile.name} is not a supported image or video format.`,
      );
    }

    if (selection.invalidSizeFiles.length > 0) {
      const invalidSizeFile = selection.invalidSizeFiles[0];
      toast.error(
        language === "fr"
          ? `${invalidSizeFile.name} doit faire moins de 10 Mo.`
          : `${invalidSizeFile.name} must be smaller than 10 MB.`,
      );
    }

    if (selection.acceptedFiles.length > 0) {
      const acceptedAttachments = selection.acceptedFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));

      setPendingAttachments((currentAttachments) => [
        ...currentAttachments,
        ...acceptedAttachments,
      ]);
    }
  }

  function handleMediaSelection(event) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    addPendingMediaFiles(selectedFiles);
  }

  React.useEffect(() => {
    let isMounted = true;

    async function loadBlockState() {
      const nextBlockState = await getUserBlockState(
        supabase,
        currentUserId,
        conversation.otherParticipant.id,
      );

      if (nextBlockState.error) {
        console.error("Failed to load conversation block state:", nextBlockState.error.message);
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
  }, [conversation.otherParticipant.id, currentUserId, supabase]);

  React.useEffect(() => {
    let isMounted = true;

    async function markConversationRead() {
      if (!conversation.hasUnreadMessages) {
        return;
      }

      const { error } = await supabase.rpc("mark_conversation_read", {
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

    }

    markConversationRead();

    return () => {
      isMounted = false;
    };
  }, [conversation.hasUnreadMessages, conversation.id, currentUserId, supabase]);

  async function cleanupAbortedSendIntent(intent) {
    const storagePaths = intent.uploadPlan.map((item) => item.storagePath);

    if (storagePaths.length > 0) {
      const { error: cleanupError } = await supabase.storage
        .from(MESSAGE_MEDIA_BUCKET)
        .remove(storagePaths);

      if (cleanupError) {
        console.error("Failed to clean up aborted message media:", cleanupError.message);
        return false;
      }

      const { error: releaseError } = await releaseMessageMediaUploadReservations(
        supabase,
        storagePaths,
      );

      if (releaseError) {
        console.error("Failed to release aborted message reservations:", releaseError.message);
        return false;
      }
    }

    return true;
  }

  async function commitCompletedSendIntent(intent, createdMessage) {
    if (createdMessage) {
      let attachments = [];
      if (intent.uploadPlan.length > 0) {
        // Use committed attachment identifiers, not synthetic IDs. A failed
        // display refresh must never turn an already committed send into a retry.
        try {
          const { data, error } = await supabase
            .from("message_attachments")
            .select("id, message_id, storage_path, file_name, mime_type, size_bytes, created_at")
            .eq("message_id", createdMessage.id)
            .order("created_at", { ascending: true });
          if (error) throw error;
          attachments = (data ?? []).map(withPrivateMessageMediaUrl);
        } catch {
          console.error("Sent message attachment details could not be refreshed.");
          router.refresh();
        }
      }

      if (hasNewerMessagesRef.current) {
        setHasNewerMessages(true);
      } else {
        setMessages((currentMessages) =>
          upsertConversationMessage(currentMessages, {
            ...createdMessage,
            attachments,
            reactions: [],
          }),
        );
      }
    }

    setUnresolvedSendIntent(null);
    clearPendingAttachments();
    setDraft("");
    setMessageBodyError("");

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
  }

  function showMessageSendFailure(error, hasAttachments) {
    if (isConversationClosedWriteError(error)) {
      void refreshConversationModerationState();
      toast.error(t.conversationClosedComposerLabel);
    } else if (isListingMessagingUnavailableError(error)) {
      toast.error(
        getListingMessagingUnavailableText(
          getListingMessagingUnavailableStatusFromError(error),
          t,
        ),
      );
    } else if (isMessageAttachmentSetupMissing(error)) {
      toast.error(t.mediaMessageSetupRequired);
    } else {
      toast.error(hasAttachments ? t.mediaUploadError : t.messageSendError);
    }

    console.error("Failed to send message:", error?.message ?? error);
  }

  async function reconcileFailedSendIntent(intent, originalError) {
    const attachmentPayload = intent.uploadPlan.map((item) => item.payload);
    const abortResult = await callMessageMutationWithReplay(() =>
      supabase.rpc("abort_message_send_operation", {
        p_operation_id: intent.operationId,
        p_conversation_id: intent.conversationId,
        p_body: intent.body,
        p_attachments: attachmentPayload,
      }),
    );

    if (abortResult.ambiguous || abortResult.error) {
      setUnresolvedSendIntent(intent);
      showMessageSendFailure(abortResult.error ?? originalError, attachmentPayload.length > 0);
      return false;
    }

    const outcome = getMessageOperationOutcome(abortResult.data);

    if (outcome.status === "completed") {
      await commitCompletedSendIntent(intent, outcome.message);
      return true;
    }

    const cleanupConfirmed = await cleanupAbortedSendIntent(intent);
    setUnresolvedSendIntent(cleanupConfirmed ? null : intent);
    showMessageSendFailure(originalError, attachmentPayload.length > 0);
    return cleanupConfirmed;
  }

  async function executeMessageSendIntent(intent) {
    const attachmentPayload = intent.uploadPlan.map((item) => item.payload);
    setIsSending(true);

    if (intent.uploadPlan.length > 0) {
      const expiredCleanupResult = await cleanupExpiredMessageMediaUploads(supabase);

      if (expiredCleanupResult.error && !isMessageAttachmentSetupMissing(expiredCleanupResult.error)) {
        console.error(
          "Failed to clean up expired message media reservations:",
          expiredCleanupResult.error.message,
        );
      }

      const reservationResult = await callMessageMutationWithReplay(() =>
        reserveMessageMediaUploadsIdempotent(supabase, {
          operationId: intent.operationId,
          conversationId: intent.conversationId,
          body: intent.body,
          uploadPlan: intent.uploadPlan,
        }),
      );

      if (reservationResult.ambiguous) {
        setUnresolvedSendIntent(intent);
        showMessageSendFailure(reservationResult.error, true);
        setIsSending(false);
        return;
      }

      if (reservationResult.error) {
        await reconcileFailedSendIntent(intent, reservationResult.error);
        setIsSending(false);
        return;
      }
    }

    for (const item of intent.uploadPlan) {
      if (intent.uploadedPaths.includes(item.storagePath)) {
        continue;
      }

      let uploadResult;

      try {
        uploadResult = await supabase.storage
          .from(MESSAGE_MEDIA_BUCKET)
          .upload(item.storagePath, await item.file.arrayBuffer(), {
            cacheControl: "0",
            headers: { "Cache-Control": "private, no-store, max-age=0" },
            contentType: item.file.type,
            upsert: false,
          });
      } catch (error) {
        setUnresolvedSendIntent(intent);
        showMessageSendFailure(error, true);
        setIsSending(false);
        return;
      }

      if (uploadResult.error && !isStorageObjectAlreadyPresent(uploadResult.error)) {
        await reconcileFailedSendIntent(intent, uploadResult.error);
        setIsSending(false);
        return;
      }

      const uploadedPath = uploadResult.data?.path ?? item.storagePath;

      if (uploadedPath !== item.storagePath) {
        await reconcileFailedSendIntent(
          intent,
          new Error("Uploaded message media path did not match its reservation."),
        );
        setIsSending(false);
        return;
      }

      intent.uploadedPaths.push(item.storagePath);
    }

    const sendResult = await callMessageMutationWithReplay(() =>
      supabase.rpc("send_conversation_message_idempotent", {
        p_operation_id: intent.operationId,
        p_conversation_id: intent.conversationId,
        p_body: intent.body,
        p_attachments: attachmentPayload,
      }),
    );

    if (sendResult.ambiguous) {
      setUnresolvedSendIntent(intent);
      showMessageSendFailure(sendResult.error, attachmentPayload.length > 0);
      setIsSending(false);
      return;
    }

    if (sendResult.error) {
      await reconcileFailedSendIntent(intent, sendResult.error);
      setIsSending(false);
      return;
    }

    const outcome = getMessageOperationOutcome(sendResult.data);
    await commitCompletedSendIntent(intent, outcome.message);
    setIsSending(false);
  }

  async function handleDiscardUnresolvedSend() {
    if (!unresolvedSendIntent || isSending) {
      return;
    }

    setIsSending(true);
    await reconcileFailedSendIntent(
      unresolvedSendIntent,
      new Error("Message send was cancelled."),
    );
    setIsSending(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSending) {
      return;
    }

    if (unresolvedSendIntent) {
      await executeMessageSendIntent(unresolvedSendIntent);
      return;
    }

    const bodyResult = validateMessageBody(draft, {
      allowEmpty: pendingAttachments.length > 0,
    });

    if (isConversationClosed || !bodyResult.ok) {
      if (isConversationClosed) {
        toast.error(t.conversationClosedComposerLabel);
      } else if (bodyResult.error === "too_long") {
        setMessageBodyError(t.messageBodyTooLong);
        focusFirstInvalidField(composerFormRef.current);
      }
      return;
    }

    setMessageBodyError("");

    const latestBlockState = await getUserBlockState(
      supabase,
      currentUserId,
      conversation.otherParticipant.id,
    );

    if (latestBlockState.error) {
      console.error("Failed to refresh conversation block state before send:", latestBlockState.error.message);
    } else {
      setBlockState(latestBlockState);
      const latestBlockReason = getMessagingBlockReason(latestBlockState, t);

      if (latestBlockReason) {
        toast.error(latestBlockReason);
        return;
      }
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

    const uploadPlan = buildMessageMediaUploadPlan({
      attachments: [...pendingAttachments],
      conversationId: conversation.id,
      userId: currentUserId,
      randomUUID: () => crypto.randomUUID(),
      sanitizeFileName: sanitizeMessageAttachmentFileName,
    });
    const intent = {
      operationId: createMessageSendOperationId(),
      conversationId: conversation.id,
      body: bodyResult.value,
      uploadPlan,
      uploadedPaths: [],
    };

    setIsSending(false);
    await executeMessageSendIntent(intent);
  }

  function handleComposerKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    if (
      !validateMessageBody(draft, {
        allowEmpty: pendingAttachments.length > 0,
      }).ok ||
      isSending ||
      isConversationClosed
    ) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  function rememberComposerSelection(event) {
    composerSelectionRef.current = {
      start: event.currentTarget.selectionStart ?? draft.length,
      end: event.currentTarget.selectionEnd ?? draft.length,
    };
  }

  function handleDraftChange(event) {
    const nextDraft = event.target.value;
    const nextValidation = validateMessageBody(nextDraft, {
      allowEmpty: pendingAttachments.length > 0,
    });
    setDraft(nextDraft);
    setMessageBodyError(
      nextValidation.error === "too_long" ? t.messageBodyTooLong : "",
    );
    rememberComposerSelection(event);
  }

  function handleInsertComposerEmoji(emoji) {
    const textarea = composerRef.current;
    const selection = textarea
      ? {
          start: textarea.selectionStart ?? composerSelectionRef.current.start,
          end: textarea.selectionEnd ?? composerSelectionRef.current.end,
        }
      : composerSelectionRef.current;
    const result = insertMessageEmoji({
      value: draft,
      emoji,
      selectionStart: selection.start,
      selectionEnd: selection.end,
      maxLength: MESSAGE_BODY_MAX_LENGTH,
    });

    if (!result.inserted) {
      if (countUnicodeCodePoints(draft) >= MESSAGE_BODY_MAX_LENGTH) {
        setMessageBodyError(t.messageBodyTooLong);
        focusFirstInvalidField(composerFormRef.current);
      }
      return;
    }

    setDraft(result.value);
    setMessageBodyError("");
    composerSelectionRef.current = {
      start: result.selectionStart,
      end: result.selectionEnd,
    };

    requestAnimationFrame(() => {
      const latestTextarea = composerRef.current;

      if (!latestTextarea) {
        return;
      }

      latestTextarea.focus({ preventScroll: true });
      latestTextarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  async function handleReportMessage(message) {
    setReportMessageTarget(message);
  }

  async function refreshMessageReactions() {
    const visibleMessageIds = messages.map((message) => message.id);

    if (visibleMessageIds.length === 0) {
      return;
    }

    const { data, error } = await supabase
      .from("message_reactions")
      .select("message_id, conversation_id, user_id, emoji, created_at, removed_at")
      .in("message_id", visibleMessageIds)
      .is("removed_at", null)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to refresh message reactions:", error.message);
      return;
    }

    setMessages((currentMessages) => replaceMessageReactions(currentMessages, data ?? []));
  }

  async function handleToggleReaction(message, emoji, reactedByCurrentUser) {
    if (isConversationClosed) {
      toast.error(t.conversationClosedComposerLabel);
      return;
    }

    const pendingKey = `${message.id}:${emoji}`;

    if (pendingReactionKeys.has(pendingKey)) {
      return;
    }

    const optimisticReaction = {
      message_id: message.id,
      conversation_id: conversation.id,
      user_id: currentUserId,
      emoji,
      created_at: new Date().toISOString(),
      removed_at: reactedByCurrentUser ? new Date().toISOString() : null,
    };

    setPendingReactionKeys((currentKeys) => new Set(currentKeys).add(pendingKey));
    setMessages((currentMessages) =>
      reactedByCurrentUser
        ? removeMessageReaction(currentMessages, optimisticReaction)
        : addMessageReaction(currentMessages, optimisticReaction),
    );

    let operationError = null;

    if (reactedByCurrentUser) {
      const { data: removedReaction, error } = await supabase
        .from("message_reactions")
        .update({ removed_at: optimisticReaction.removed_at })
        .eq("message_id", message.id)
        .eq("user_id", currentUserId)
        .eq("emoji", emoji)
        .select("message_id")
        .maybeSingle();
      operationError = error;

      if (!error && !removedReaction) {
        await refreshMessageReactions();
      }
    } else {
      const { data: restoredReaction, error: restoreError } = await supabase
        .from("message_reactions")
        .update({ removed_at: null })
        .eq("message_id", message.id)
        .eq("user_id", currentUserId)
        .eq("emoji", emoji)
        .not("removed_at", "is", null)
        .select("message_id, conversation_id, user_id, emoji, created_at, removed_at")
        .maybeSingle();

      if (restoreError) {
        operationError = restoreError;
      } else if (!restoredReaction) {
        const { error: insertError } = await supabase.from("message_reactions").insert({
          message_id: message.id,
          conversation_id: conversation.id,
          user_id: currentUserId,
          emoji,
        });
        operationError = insertError;
      }
    }

    setPendingReactionKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      nextKeys.delete(pendingKey);
      return nextKeys;
    });

    if (operationError) {
      console.error("Failed to update message reaction:", operationError.message);
      if (isConversationClosedWriteError(operationError)) {
        await refreshConversationModerationState();
        toast.error(t.conversationClosedComposerLabel);
      } else {
        toast.error(t.reactionUpdateError);
      }
      await refreshMessageReactions();
    }
  }

  return (
    <section className="@container/thread flex min-h-0 max-w-full flex-1 touch-pan-y flex-col overflow-hidden overscroll-x-none border-y border-zinc-200 bg-white/95 dark:border-border dark:bg-card md:rounded-2xl md:border md:shadow-sm">
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-border md:px-3">
        <div className="flex flex-col gap-2 @2xl/thread:flex-row @2xl/thread:items-center @2xl/thread:justify-between">
          {isAnnouncementConversation ? (
            <div className="block rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-2 dark:border-border dark:bg-muted/30 @2xl/thread:w-full @2xl/thread:max-w-sm">
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-muted dark:text-muted-foreground md:size-12">
                  <Megaphone className="size-5 md:size-6" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] font-semibold leading-4 text-zinc-950 dark:text-foreground md:text-sm md:leading-5">
                    {t.announcements}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-zinc-500 dark:text-muted-foreground">
                    {t.announcementConversationDescription}
                  </p>
                </div>
              </div>
            </div>
          ) : hasListingLink ? (
            <Link
              href={`/listings/${conversation.listing.slug}`}
              className="block rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-1.5 transition hover:bg-zinc-100/80 dark:border-border dark:bg-muted/30 dark:hover:bg-muted/50 @2xl/thread:w-full @2xl/thread:max-w-sm"
            >
              <div className="flex items-center gap-3">
                <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-muted">
                  {conversation.listing.imageUrl ? (
                    <Image
                      src={conversation.listing.imageUrl}
                      alt={conversation.listing.title}
                      fill
                      sizes="40px"
                      placeholder="blur"
                      blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
                      className="object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] font-semibold leading-4 text-zinc-950 dark:text-foreground md:text-sm md:leading-5">
                    {conversation.listing.title}
                  </p>
                  <p className="mt-1 truncate text-xs font-semibold text-zinc-900 dark:text-foreground">
                    {formatPrice(conversation.listing.price, language)}
                  </p>
                  <p className="mt-0.5 truncate text-[0.6875rem] leading-4 text-zinc-500 dark:text-muted-foreground md:text-xs">
                    {conversation.listing.location || t.torontoMeetup}
                  </p>
                </div>
              </div>
            </Link>
          ) : (
            <div className="block rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-2 dark:border-border dark:bg-muted/30 @2xl/thread:w-full @2xl/thread:max-w-sm">
              <div className="flex items-center gap-3">
                <div className="size-11 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-muted md:size-12">
                  <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] font-semibold leading-4 text-zinc-950 dark:text-foreground md:text-sm md:leading-5">
                    {t.deletedListingTitle}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-zinc-500 dark:text-muted-foreground">
                    {t.deletedListingDescription}
                  </p>
                </div>
              </div>
            </div>
          )}

          {conversation.otherParticipant.id ? (
            <div className="flex min-w-0 items-center justify-between gap-2 @2xl/thread:self-center">
              <Link
                href={`/profile/${conversation.otherParticipant.id}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl transition hover:bg-zinc-50/80 dark:hover:bg-muted/40"
              >
                <ProfileAvatar
                  name={conversation.otherParticipant.name}
                  avatarPresetId={conversation.otherParticipant.avatarPresetId}
                  avatarUrl={conversation.otherParticipant.avatarUrl}
                  className="size-8 border border-zinc-200 dark:border-border md:size-9"
                />

                <div className="min-w-0">
                  <h1 className="truncate text-sm font-semibold text-zinc-950 dark:text-foreground md:text-base">
                    {conversation.otherParticipant.name}
                  </h1>
                  <p className="truncate text-[0.6875rem] leading-4 text-zinc-500 dark:text-muted-foreground md:text-xs">
                    {conversation.otherParticipant.school || t.torontoStudent}
                  </p>
                </div>
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="size-11 rounded-full"
                    aria-label={t.moreActions}
                    disabled={isHiding || isDeletingConversation || isUpdatingBlockState}
                  >
                    <EllipsisVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 rounded-2xl">
                  <DropdownMenuItem
                    disabled={isHiding || isDeletingConversation || isUpdatingBlockState}
                    onSelect={(event) => {
                      event.preventDefault();
                      setIsHideDialogOpen(true);
                    }}
                  >
                    {isHiddenConversation ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    <span>{isHiddenConversation ? t.restoreConversation : t.hideConversation}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isDeletingConversation || isUpdatingBlockState}
                    onSelect={(event) => {
                      event.preventDefault();
                      setIsDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="size-4" />
                    <span>{t.deleteConversation}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isHiding || isDeletingConversation || isUpdatingBlockState}
                    onSelect={(event) => {
                      event.preventDefault();
                      setIsBlockDialogOpen(true);
                    }}
                  >
                    <Flag className="size-4" />
                    <span>{blockState.blockedByCurrentUser ? t.unblockUser : t.blockUser}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2 @2xl/thread:self-center">
              {conversation.isAnnouncement ? (
                <div className="flex size-9 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-border dark:bg-muted dark:text-muted-foreground">
                  <Megaphone className="size-5" />
                </div>
              ) : (
                <ProfileAvatar
                  name={conversation.otherParticipant.name}
                  avatarPresetId={conversation.otherParticipant.avatarPresetId}
                  avatarUrl={conversation.otherParticipant.avatarUrl}
                  className="size-9 border border-zinc-200 dark:border-border"
                />
              )}

              <div>
                <h1 className="text-sm font-semibold text-zinc-950 dark:text-foreground md:text-base">
                  {conversation.otherParticipant.name}
                </h1>
                <p className="text-[0.6875rem] leading-4 text-zinc-500 dark:text-muted-foreground md:text-xs">
                  {conversation.otherParticipant.school || t.torontoStudent}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {isConversationClosed ? (
        <aside
          role="status"
          aria-labelledby={`conversation-closed-title-${conversation.id}`}
          className="shrink-0 border-b border-amber-200/80 bg-amber-50/80 px-3 py-2.5 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-100 md:px-5"
        >
          <div className="mx-auto flex w-full max-w-4xl min-w-0 gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/70 dark:text-amber-100">
              <LockKeyhole className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id={`conversation-closed-title-${conversation.id}`}
                className="text-sm font-semibold leading-5"
              >
                {t.conversationClosedTitle}
              </h2>
              <p className="mt-0.5 text-xs leading-5 text-amber-900/80 dark:text-amber-100/75">
                {t.conversationClosedReadOnly}
              </p>
              <dl className="mt-1.5 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 text-xs leading-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                  <dt className="inline font-semibold">{t.conversationClosedReasonLabel}: </dt>
                  <dd className="inline break-words">
                    {moderationState?.userMessage || t.conversationClosedReasonFallback}
                  </dd>
                </div>
                {moderationState?.changedAt ? (
                  <div className="min-w-0">
                    <dt className="inline font-semibold">{t.conversationClosedAtLabel}: </dt>
                    <dd className="inline">
                      <ClientFormattedDateTime
                        value={moderationState.changedAt}
                        language={language}
                      />
                    </dd>
                  </div>
                ) : null}
                <div className="min-w-0">
                  <dt className="inline font-semibold">{t.conversationClosedUntilLabel}: </dt>
                  <dd className="inline">
                    {moderationState?.closedUntil ? (
                      <ClientFormattedDateTime
                        value={moderationState.closedUntil}
                        language={language}
                      />
                    ) : (
                      t.conversationClosedIndefinitely
                    )}
                  </dd>
                </div>
              </dl>
              <a
                href="mailto:support@studentmarketoftoronto.ca"
                className="mt-1.5 inline-flex min-h-8 items-center gap-1.5 rounded-lg text-xs font-semibold underline decoration-amber-700/50 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-amber-700/50 dark:decoration-amber-300/50"
              >
                <LifeBuoy className="size-3.5" aria-hidden="true" />
                {t.conversationClosedSupportLink}
              </a>
            </div>
          </div>
        </aside>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {moderationLiveStatus}
      </p>

      <div className="min-h-0 max-w-full flex-1 touch-pan-y space-y-1 overflow-x-hidden overflow-y-auto overscroll-x-none overscroll-y-contain bg-zinc-50/60 px-3 py-3 dark:bg-muted/15 md:px-5 md:py-4">
        {hasOlderMessages ? (
          <div className="mx-auto flex w-full max-w-4xl justify-center pb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={isLoadingHistory}
              onClick={handleLoadOlderMessages}
            >
              {isLoadingHistory ? t.loadingOlderMessages : t.loadOlderMessages}
            </Button>
          </div>
        ) : null}
        {hasNewerMessages ? (
          <div className="mx-auto flex w-full max-w-4xl justify-center pb-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              disabled={isLoadingHistory}
              onClick={handleReturnToNewestMessages}
            >
              {t.returnToNewestMessages}
            </Button>
          </div>
        ) : null}
        {messages.length > 0 ? (
          messages.map((message, messageIndex) => {
            const isCurrentUser = message.sender_id === currentUserId;
            const participant = isCurrentUser
              ? conversation.currentParticipant
              : conversation.otherParticipant;
            const isGrouped = isGroupedWithPreviousMessage(
              message,
              messages[messageIndex - 1],
            );

            return (
              <div
                key={message.id}
                className={`group/message mx-auto flex w-full max-w-4xl items-end gap-1.5 ${
                  isCurrentUser ? "flex-row-reverse" : ""
                } ${isGrouped ? "pt-0.5" : messageIndex > 0 ? "pt-2.5" : ""}`}
              >
                {isGrouped ? (
                  <span className="size-7 shrink-0 md:size-8" aria-hidden="true" />
                ) : conversation.isAnnouncement && !isCurrentUser ? (
                  <div className="flex size-7 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-border dark:bg-muted dark:text-muted-foreground md:size-8">
                    <Megaphone className="size-4.5" />
                  </div>
                ) : (
                  <ProfileAvatar
                    name={participant.name}
                    avatarPresetId={participant.avatarPresetId}
                    avatarUrl={participant.avatarUrl}
                    className="size-7 border border-zinc-200 dark:border-border md:size-8"
                  />
                )}

                <div
                  className={`flex min-w-0 max-w-[calc(100%-5.25rem)] flex-col gap-0.5 sm:max-w-[min(70%,36rem)] ${
                    isCurrentUser ? "items-end" : "items-start"
                  }`}
                >
                  {!isGrouped ? (
                    <p className="px-1 text-[0.6875rem] leading-4 text-zinc-500 dark:text-muted-foreground md:text-xs">
                      <span className="font-semibold text-zinc-900 dark:text-foreground">
                        {isCurrentUser ? t.you : participant.name}
                      </span>{" "}
                      <ClientFormattedDateTime value={message.created_at} language={language} />
                    </p>
                  ) : null}

                  <div
                    className={`flex items-center gap-1.5 ${
                      isCurrentUser ? "flex-row-reverse self-end" : "self-start"
                    }`}
                  >
                    <div
                      className={`overflow-hidden rounded-[1.1rem] text-left ${
                        message.attachments?.length === 1
                          ? "w-[min(13rem,60vw)] p-0 sm:w-56 md:w-64"
                          : message.attachments?.length > 1
                            ? "w-[min(14rem,64vw)] p-0 sm:w-64 md:w-72"
                            : "w-fit px-3 py-2"
                      } ${
                        isCurrentUser
                          ? "rounded-tr-sm border border-zinc-300/80 bg-zinc-200/90 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                          : "rounded-tl-sm border border-zinc-200 bg-white/90 text-zinc-900 dark:border-border dark:bg-card dark:text-foreground"
                      }`}
                    >
                      {message.attachments?.length > 0 ? (
                        <MessageMediaGallery attachments={message.attachments} />
                      ) : null}
                      {message.body ? (
                        <p
                          className={`whitespace-pre-wrap break-words text-[0.8125rem] leading-5 md:text-sm md:leading-6 ${
                            message.attachments?.length > 0 ? "px-3 pb-2 pt-2" : ""
                          }`}
                        >
                          {message.body}
                        </p>
                      ) : null}
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={t.moreActions}
                          className="relative z-10 !size-8 !min-h-8 !min-w-8 shrink-0 rounded-full border-zinc-300 bg-white text-zinc-700 opacity-100 shadow-sm transition-opacity after:absolute after:-inset-1.5 after:rounded-full after:content-[''] md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                        >
                          <EllipsisVertical className="size-3.5" />
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
                  </div>

                  <MessageReactions
                    reactions={message.reactions ?? []}
                    currentUserId={currentUserId}
                    isCurrentUser={isCurrentUser}
                    isPending={[...pendingReactionKeys].some((key) =>
                      key.startsWith(`${message.id}:`),
                    )}
                    isAddingDisabled={
                      isAnnouncementConversation ||
                      isConversationClosed ||
                      !isMessagingAvailable ||
                      Boolean(blockReason)
                    }
                    isInteractionDisabled={isConversationClosed}
                    onToggle={(emoji, reactedByCurrentUser) =>
                      handleToggleReaction(message, emoji, reactedByCurrentUser)
                    }
                    labels={{
                      reactions: t.messageReactions,
                      addReaction: t.addReaction,
                      removeReaction: t.removeReaction,
                      pickerLabel: t.reactionPickerLabel,
                      reactionCount: (count) =>
                        (count === 1
                          ? t.reactionCountSingleLabel
                          : t.reactionCountLabel
                        ).replace("{count}", String(count)),
                    }}
                  />
                </div>

              </div>
            );
          })
        ) : (
          <div className="flex h-full min-h-[220px] items-center justify-center rounded-[1.5rem] border border-dashed border-zinc-300 bg-white/70 p-5 text-center dark:border-border dark:bg-card/70 md:min-h-[280px] md:p-8">
            <div className="max-w-md">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-foreground">
                {t.noMessagesYetTitle}
              </h2>
              <p className="mt-2 text-sm text-zinc-500 dark:text-muted-foreground">
                {hasDeletedMessages
                  ? t.deletedConversationEmptyStateDescription
                  : t.noMessagesYetDescription}
              </p>
            </div>
          </div>
        )}
      </div>

      {isConversationClosed ? (
        <div className="sticky bottom-0 z-20 shrink-0 border-t border-zinc-200 bg-white/95 px-2.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm dark:border-border dark:bg-card/95 md:px-4 md:py-3">
          <div
            role="note"
            className="mx-auto flex min-w-0 max-w-4xl items-start gap-2.5 rounded-[1.1rem] border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-border dark:bg-muted/25"
          >
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-zinc-500 dark:text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5 text-zinc-950 dark:text-foreground">
                {t.conversationClosedComposerLabel}
              </p>
              <p className="text-xs leading-5 text-zinc-500 dark:text-muted-foreground">
                {t.conversationClosedComposerDescription}
              </p>
            </div>
          </div>
        </div>
      ) : (
      <form ref={composerFormRef} onSubmit={handleSubmit} className="sticky bottom-0 z-20 shrink-0 border-t border-zinc-200 bg-white/95 px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-sm dark:border-border dark:bg-card/95 md:px-3 md:py-2">
        <div
          {...dropzoneProps}
          className={`relative mx-auto w-full max-w-5xl rounded-[1.1rem] border bg-zinc-50/70 p-1 transition-colors dark:bg-muted/20 ${
            isDragActive && isMediaSelectionAvailable
              ? "border-dashed border-primary ring-2 ring-primary/20"
              : "border-zinc-200 dark:border-border"
          }`}
        >
          {isDragActive && isMediaSelectionAvailable ? (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute inset-0 z-30 hidden items-center justify-center rounded-[1.1rem] border-2 border-dashed border-primary bg-background/95 p-4 text-center backdrop-blur-sm md:flex"
            >
              <div>
                <Paperclip className="mx-auto size-6 text-primary" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {t.dropMessageMedia}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.mediaAttachmentHelp}
                </p>
              </div>
            </div>
          ) : null}
          {blockReason ? (
            <p className="px-2 pb-3 text-sm text-muted-foreground">{blockReason}</p>
          ) : null}
          {!isMessagingAvailable ? (
            <p className="px-2 pb-3 text-sm text-muted-foreground">{messagingUnavailableText}</p>
          ) : null}
          <input
            ref={mediaInputRef}
            type="file"
            accept={MESSAGE_ATTACHMENT_ACCEPT}
            multiple
            className="sr-only"
            aria-label={t.attachMedia}
            onChange={handleMediaSelection}
            disabled={!isMessagingAvailable || Boolean(blockReason) || isSending}
          />
          {pendingAttachments.length > 0 ? (
            <div className="mb-2 flex gap-2 overflow-x-auto px-1 pb-1" aria-label={t.selectedMedia}>
              {pendingAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-muted md:size-18"
                >
                  {getAttachmentKind(attachment.file.type) === "video" ? (
                    <video
                      src={attachment.previewUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                      aria-label={attachment.file.name}
                    />
                  ) : (
                    <Image
                      src={attachment.previewUrl}
                      alt={attachment.file.name}
                      fill
                      unoptimized
                      sizes="(max-width: 767px) 64px, 72px"
                      className="object-cover"
                    />
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    className="absolute right-1 top-1 size-11 rounded-full bg-black/75 text-white hover:bg-black md:size-8 md:min-h-8 md:min-w-8"
                    aria-label={`${t.removeAttachment}: ${attachment.file.name}`}
                    onClick={() => removePendingAttachment(attachment.id)}
                    disabled={isSending || isSendIntentLocked}
                  >
                    <X className="size-3.5" />
                  </Button>
                  <span className="absolute inset-x-1 bottom-1 truncate rounded-md bg-black/70 px-1.5 py-0.5 text-[0.625rem] text-white">
                    {formatAttachmentSize(attachment.file.size, language)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex min-w-0 items-end gap-0.5">
            <div className="flex shrink-0 items-center self-end">
              <MessageEmojiPicker
                disabled={
                  !isMessagingAvailable || Boolean(blockReason) || isSending || isSendIntentLocked
                }
                onSelect={handleInsertComposerEmoji}
                labels={{
                  addEmoji: t.addMessageEmoji,
                  insertEmoji: t.insertMessageEmoji,
                  pickerLabel: t.messageEmojiPickerLabel,
                  pickerHint: t.messageEmojiPickerHint,
                }}
              />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-10 rounded-full text-zinc-500 dark:text-muted-foreground md:size-11"
                    disabled={
                      !isMessagingAvailable ||
                      Boolean(blockReason) ||
                      isSending ||
                      isSendIntentLocked ||
                      pendingAttachments.length >= MAX_MESSAGE_ATTACHMENTS
                    }
                    aria-label={t.attachMedia}
                    onClick={() => mediaInputRef.current?.click()}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  {t.mediaAttachmentHelp}
                </TooltipContent>
              </Tooltip>

            </div>

            <Textarea
              id="conversation-message-body"
              ref={composerRef}
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={handleComposerKeyDown}
              onKeyUp={rememberComposerSelection}
              onSelect={rememberComposerSelection}
              onBlur={rememberComposerSelection}
              placeholder={t.messageInputPlaceholder}
              rows={1}
              className="min-h-10 max-h-32 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2.5 text-base leading-5 shadow-none [field-sizing:content] focus-visible:ring-0"
              aria-invalid={Boolean(messageBodyError)}
              aria-describedby="conversation-message-body-count conversation-message-body-error"
              disabled={
                !isMessagingAvailable || Boolean(blockReason) || isSending || isSendIntentLocked
              }
            />

            <p
              id="conversation-message-body-count"
              className={draftCharacterCount >= 1800 ? "shrink-0 self-center px-1 text-xs text-zinc-500 dark:text-muted-foreground" : "sr-only"}
            >
              {t.messageBodyCharacterCount.replace("{count}", String(draftCharacterCount))}
            </p>

            {isSendIntentLocked ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSending}
                onClick={handleDiscardUnresolvedSend}
              >
                {t.cancel}
              </Button>
            ) : null}

            <Button
              type="submit"
              disabled={
                !isMessagingAvailable ||
                Boolean(blockReason) ||
                isSending ||
                (!isSendIntentLocked && !draftValidation.ok)
              }
              size="icon-lg"
              className="size-11 rounded-full"
              aria-label={
                isSending ? t.sendingMessage : isSendIntentLocked ? t.retry : t.sendMessage
              }
            >
              <SendHorizontal className="size-4.5" />
            </Button>
          </div>

          {messageBodyError ? (
            <p
              id="conversation-message-body-error"
              role="alert"
              className="px-12 pb-1 pt-0.5 text-xs text-red-600 dark:text-red-400"
            >
              {messageBodyError}
            </p>
          ) : (
            <span id="conversation-message-body-error" className="sr-only" />
          )}
        </div>
      </form>
      )}

      <ReportSheet
        open={Boolean(reportMessageTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setReportMessageTarget(null);
          }
        }}
        subjectType="message"
        subjectId={reportMessageTarget?.id ?? null}
        currentUserId={currentUserId}
      />

      <AlertDialog open={isHideDialogOpen} onOpenChange={setIsHideDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isHiddenConversation ? t.restoreConversationTitle : t.hideConversationTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isHiddenConversation
                ? t.restoreConversationDescription
                : t.hideConversationDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isHiding}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={isHiddenConversation ? handleRestoreConversation : handleHideConversation}
              disabled={isHiding}
            >
              {isHiding ? t.saving : isHiddenConversation ? t.restoreConversation : t.hideConversation}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteConversationTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteConversationDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingConversation}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConversation}
              disabled={isDeletingConversation}
            >
              {isDeletingConversation ? t.saving : t.deleteConversation}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isBlockDialogOpen} onOpenChange={setIsBlockDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {blockState.blockedByCurrentUser ? t.unblockUserTitle : t.blockUserTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {blockState.blockedByCurrentUser ? t.unblockUserDescription : t.blockUserDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdatingBlockState}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleUpdateBlockState} disabled={isUpdatingBlockState}>
              {isUpdatingBlockState
                ? t.saving
                : blockState.blockedByCurrentUser
                  ? t.unblockUser
                  : t.blockUser}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
