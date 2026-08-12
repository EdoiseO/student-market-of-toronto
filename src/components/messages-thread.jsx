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
  Megaphone,
  Paperclip,
  SendHorizontal,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ProfileAvatar } from "@/components/profile-avatar";
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
import { ReportSheet } from "@/components/report-sheet";
import { useLanguage } from "@/context/LanguageContext";
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
import {
  buildMessageMediaUploadPlan,
  cleanupExpiredMessageMediaUploads,
  releaseMessageMediaUploadReservations,
  reserveMessageMediaUploads,
} from "@/lib/message-media-reservations.mjs";
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

function MessageAttachment({ attachment, t }) {
  if (!attachment.signedUrl) {
    return (
      <div className="flex aspect-[4/3] w-56 max-w-full items-center justify-center rounded-2xl bg-zinc-100 px-4 text-center text-xs text-zinc-500 dark:bg-muted dark:text-muted-foreground">
        {t.attachmentUnavailable}
      </div>
    );
  }

  if (getAttachmentKind(attachment.mime_type) === "video") {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        className="aspect-[4/3] w-64 max-w-full rounded-2xl bg-black object-contain"
        aria-label={attachment.file_name}
      >
        <source src={attachment.signedUrl} type={attachment.mime_type} />
      </video>
    );
  }

  return (
    <a
      href={attachment.signedUrl}
      target="_blank"
      rel="noreferrer"
      className="relative block aspect-[4/3] w-64 max-w-full overflow-hidden rounded-2xl bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-muted"
      aria-label={`${t.openAttachment}: ${attachment.file_name}`}
    >
      <Image
        src={attachment.signedUrl}
        alt={attachment.file_name}
        fill
        unoptimized
        sizes="(max-width: 639px) 68vw, 288px"
        className="object-contain"
      />
    </a>
  );
}

export function MessagesThread({
  conversation,
  currentUserId,
  initialMessages,
  hasDeletedMessages = false,
  isHiddenConversation = false,
}) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const [messages, setMessages] = React.useState(initialMessages ?? []);
  const [draft, setDraft] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const [pendingAttachments, setPendingAttachments] = React.useState([]);
  const pendingAttachmentsRef = React.useRef([]);
  const mediaInputRef = React.useRef(null);
  const [reportMessageTarget, setReportMessageTarget] = React.useState(null);
  const [blockState, setBlockState] = React.useState({
    blockedByCurrentUser: false,
    blockedCurrentUser: false,
    available: true,
  });
  const isAnnouncementConversation = Boolean(conversation.isAnnouncement);
  const isMessagingAvailable =
    !isAnnouncementConversation && isListingMessagingAvailable(conversation.listing.status);
  const [isHideDialogOpen, setIsHideDialogOpen] = React.useState(false);
  const [isHiding, setIsHiding] = React.useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [isDeletingConversation, setIsDeletingConversation] = React.useState(false);
  const [isBlockDialogOpen, setIsBlockDialogOpen] = React.useState(false);
  const [isUpdatingBlockState, setIsUpdatingBlockState] = React.useState(false);

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

  React.useEffect(() => {
    setMessages(initialMessages ?? []);
  }, [conversation.id, initialMessages]);

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

  function handleMediaSelection(event) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) {
      return;
    }

    const availableSlots = MAX_MESSAGE_ATTACHMENTS - pendingAttachments.length;

    if (availableSlots <= 0) {
      toast.error(
        language === "fr"
          ? `Vous pouvez joindre jusqu’à ${MAX_MESSAGE_ATTACHMENTS} fichiers.`
          : `You can attach up to ${MAX_MESSAGE_ATTACHMENTS} files.`,
      );
      return;
    }

    const acceptedFiles = [];

    if (selectedFiles.length > availableSlots) {
      toast.error(
        language === "fr"
          ? `Vous pouvez joindre jusqu’à ${MAX_MESSAGE_ATTACHMENTS} fichiers.`
          : `You can attach up to ${MAX_MESSAGE_ATTACHMENTS} files.`,
      );
    }

    for (const file of selectedFiles.slice(0, availableSlots)) {
      if (!MESSAGE_ATTACHMENT_MIME_TYPES.has(file.type)) {
        toast.error(
          language === "fr"
            ? `${file.name} n’est pas un format d’image ou de vidéo pris en charge.`
            : `${file.name} is not a supported image or video format.`,
        );
        continue;
      }

      if (file.size <= 0 || file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
        toast.error(
          language === "fr"
            ? `${file.name} doit faire moins de 10 Mo.`
            : `${file.name} must be smaller than 10 MB.`,
        );
        continue;
      }

      acceptedFiles.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (acceptedFiles.length > 0) {
      setPendingAttachments((currentAttachments) => [
        ...currentAttachments,
        ...acceptedFiles,
      ]);
    }
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

    if (isSending || (!draft.trim() && pendingAttachments.length === 0)) {
      return;
    }

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

    const attachmentsToSend = [...pendingAttachments];
    const uploadedPaths = [];
    let reservedPaths = [];
    let messageWasCreated = false;

    try {
      const uploadPlan = buildMessageMediaUploadPlan({
        attachments: attachmentsToSend,
        conversationId: conversation.id,
        userId: currentUserId,
        randomUUID: () => crypto.randomUUID(),
        sanitizeFileName: sanitizeMessageAttachmentFileName,
      });
      const attachmentPayload = uploadPlan.map((item) => item.payload);

      if (uploadPlan.length > 0) {
        const expiredCleanupResult = await cleanupExpiredMessageMediaUploads(supabase);

        if (expiredCleanupResult.error && !isMessageAttachmentSetupMissing(expiredCleanupResult.error)) {
          console.error(
            "Failed to clean up expired message media reservations:",
            expiredCleanupResult.error.message,
          );
        }

        // Record the exact planned paths before the RPC. If the response is lost
        // after the database commits, the catch path can still release them.
        reservedPaths = uploadPlan.map((item) => item.storagePath);
        const { error: reservationError } = await reserveMessageMediaUploads(
          supabase,
          conversation.id,
          uploadPlan,
        );

        if (reservationError) {
          throw reservationError;
        }
      }

      for (const item of uploadPlan) {
        const { data: uploadedObject, error: uploadError } = await supabase.storage
          .from(MESSAGE_MEDIA_BUCKET)
          .upload(item.storagePath, item.file, {
            cacheControl: "3600",
            contentType: item.file.type,
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        const uploadedPath = uploadedObject?.path ?? item.storagePath;

        if (uploadedPath !== item.storagePath) {
          throw new Error("Uploaded message media path did not match its reservation.");
        }

        uploadedPaths.push(uploadedPath);
      }

      const messageOperation = attachmentPayload.length > 0
        ? supabase.rpc("send_conversation_message_with_attachments", {
            p_conversation_id: conversation.id,
            p_body: draft,
            p_attachments: attachmentPayload,
          })
        : supabase.rpc("send_conversation_message", {
            p_conversation_id: conversation.id,
            p_body: draft,
          });
      const { data, error } = await messageOperation;

      if (error) {
        throw error;
      }

      messageWasCreated = true;
      reservedPaths = [];
      const createdMessage = Array.isArray(data) ? data[0] : data;

      if (createdMessage) {
        let signedRows = [];

        if (uploadedPaths.length > 0) {
          const { data: signedUrlRows, error: signedUrlsError } = await supabase.storage
            .from(MESSAGE_MEDIA_BUCKET)
            .createSignedUrls(uploadedPaths, 60 * 60);

          if (signedUrlsError) {
            console.error("Failed to sign sent message media:", signedUrlsError.message);
          } else {
            signedRows = signedUrlRows ?? [];
          }
        }

        setMessages((currentMessages) => [
          ...currentMessages,
          {
            ...createdMessage,
            attachments: attachmentPayload.map((attachment, index) => ({
              id: `${createdMessage.id}-${index}`,
              message_id: createdMessage.id,
              ...attachment,
              signedUrl: signedRows[index]?.signedUrl ?? null,
            })),
          },
        ]);
      }

      clearPendingAttachments();
      setDraft("");
    } catch (error) {
      if (!messageWasCreated && uploadedPaths.length > 0) {
        const { error: cleanupError } = await supabase.storage
          .from(MESSAGE_MEDIA_BUCKET)
          .remove(uploadedPaths);

        if (cleanupError) {
          console.error("Failed to clean up unsent message media:", cleanupError.message);
        }
      }

      if (!messageWasCreated && reservedPaths.length > 0) {
        const { error: releaseError } = await releaseMessageMediaUploadReservations(
          supabase,
          reservedPaths,
        );

        if (releaseError) {
          console.error(
            "Failed to release unsent message media reservations:",
            releaseError.message,
          );
        }
      }

      if (isListingMessagingUnavailableError(error)) {
        toast.error(
          getListingMessagingUnavailableText(
            getListingMessagingUnavailableStatusFromError(error),
            t,
          ),
        );
      } else if (isMessageAttachmentSetupMissing(error)) {
        toast.error(t.mediaMessageSetupRequired);
      } else {
        toast.error(attachmentsToSend.length > 0 ? t.mediaUploadError : t.messageSendError);
      }

      console.error("Failed to send message:", error?.message ?? error);
      setIsSending(false);
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

    setIsSending(false);
    router.refresh();
  }

  function handleComposerKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    if ((!draft.trim() && pendingAttachments.length === 0) || isSending) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  async function handleReportMessage(message) {
    setReportMessageTarget(message);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-y border-zinc-200 bg-white/95 dark:border-border dark:bg-card md:rounded-[2rem] md:border md:shadow-sm">
      <div className="shrink-0 border-b border-zinc-200 p-3 dark:border-border md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {isAnnouncementConversation ? (
            <div className="block rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-2.5 dark:border-border dark:bg-muted/30 lg:w-full lg:max-w-md">
              <div className="flex items-center gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-muted dark:text-muted-foreground md:size-14">
                  <Megaphone className="size-6 md:size-7" />
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
              className="block rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-2.5 transition hover:bg-zinc-100/80 dark:border-border dark:bg-muted/30 dark:hover:bg-muted/50 lg:w-full lg:max-w-md"
            >
              <div className="flex items-center gap-3">
                <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-zinc-100 dark:bg-muted md:size-14">
                  {conversation.listing.imageUrl ? (
                    <Image
                      src={conversation.listing.imageUrl}
                      alt={conversation.listing.title}
                      fill
                      sizes="(max-width: 767px) 48px, 56px"
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
            <div className="block rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-2.5 dark:border-border dark:bg-muted/30 lg:w-full lg:max-w-md">
              <div className="flex items-center gap-3">
                <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-zinc-100 dark:bg-muted md:size-14">
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
            <div className="flex items-center gap-2 lg:self-center">
              <Link
                href={`/profile/${conversation.otherParticipant.id}`}
                className="flex min-w-0 items-center gap-2.5 rounded-xl transition hover:bg-zinc-50/80 dark:hover:bg-muted/40"
              >
                <ProfileAvatar
                  name={conversation.otherParticipant.name}
                  avatarPresetId={conversation.otherParticipant.avatarPresetId}
                  avatarUrl={conversation.otherParticipant.avatarUrl}
                  className="size-9 border border-zinc-200 dark:border-border"
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
            <div className="flex items-center gap-2.5 lg:self-center">
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

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain bg-zinc-50/60 px-3.5 py-4 dark:bg-muted/15 md:space-y-4 md:px-6 md:py-5">
        {messages.length > 0 ? (
          messages.map((message) => {
            const isCurrentUser = message.sender_id === currentUserId;
            const participant = isCurrentUser
              ? conversation.currentParticipant
              : conversation.otherParticipant;

            return (
              <div
                key={message.id}
                className={`group/message flex items-end gap-2 ${isCurrentUser ? "flex-row-reverse" : ""}`}
              >
                {conversation.isAnnouncement && !isCurrentUser ? (
                  <div className="flex size-8 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-border dark:bg-muted dark:text-muted-foreground md:size-9">
                    <Megaphone className="size-4.5" />
                  </div>
                ) : (
                  <ProfileAvatar
                    name={participant.name}
                    avatarPresetId={participant.avatarPresetId}
                    avatarUrl={participant.avatarUrl}
                    className="size-8 border border-zinc-200 dark:border-border md:size-9"
                  />
                )}

                <div
                  className={`relative flex min-w-0 max-w-[78vw] flex-col gap-1 sm:max-w-[68%] ${
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
                        className={`absolute top-1/2 z-10 size-11 -translate-y-1/2 rounded-full border-zinc-300 bg-white text-zinc-700 opacity-0 shadow-sm transition group-hover/message:opacity-100 group-focus-within/message:opacity-100 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted ${
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

                  <p className="px-1 text-[0.6875rem] leading-4 text-zinc-500 dark:text-muted-foreground md:text-xs">
                    <span className="font-semibold text-zinc-900 dark:text-foreground">
                      {isCurrentUser ? t.you : participant.name}
                    </span>{" "}
                    <ClientFormattedDateTime value={message.created_at} language={language} />
                  </p>

                  <div
                    className={`w-fit rounded-[1.25rem] text-left ${
                      message.attachments?.length > 0 ? "p-1.5" : "px-3.5 py-2.5"
                    } ${
                      isCurrentUser
                        ? "rounded-tr-sm border border-zinc-300/80 bg-zinc-200/90 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                        : "rounded-tl-sm border border-zinc-200 bg-white/90 text-zinc-900 dark:border-border dark:bg-card dark:text-foreground"
                    }`}
                  >
                    {message.attachments?.length > 0 ? (
                      <div
                        className={
                          message.attachments.length > 1
                            ? "grid grid-cols-2 gap-1.5 [&_a]:w-28 [&_video]:w-28 sm:[&_a]:w-36 sm:[&_video]:w-36"
                            : ""
                        }
                      >
                        {message.attachments.map((attachment) => (
                          <MessageAttachment
                            key={attachment.id}
                            attachment={attachment}
                            t={t}
                          />
                        ))}
                      </div>
                    ) : null}
                    {message.body ? (
                      <p
                        className={`whitespace-pre-wrap break-words text-[0.8125rem] leading-5 md:text-sm md:leading-6 ${
                          message.attachments?.length > 0 ? "px-2 pb-1 pt-2" : ""
                        }`}
                      >
                        {message.body}
                      </p>
                    ) : null}
                  </div>
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

      <form onSubmit={handleSubmit} className="sticky bottom-0 z-20 shrink-0 border-t border-zinc-200 bg-white/95 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-sm dark:border-border dark:bg-card/95 md:p-5">
        <div className="rounded-[1.35rem] border border-zinc-200 bg-zinc-50/70 p-2.5 dark:border-border dark:bg-muted/20">
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
                  className="relative size-20 shrink-0 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-muted"
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
                      sizes="80px"
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
                    disabled={isSending}
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
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={t.messageInputPlaceholder}
            rows={2}
            className="h-12 min-h-12 max-h-32 resize-none border-0 bg-transparent px-2 py-1.5 text-base leading-5 shadow-none focus-visible:ring-0 md:h-14 md:min-h-14"
            maxLength={2000}
            disabled={!isMessagingAvailable || Boolean(blockReason) || isSending}
          />

          <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-zinc-200 px-1.5 pt-2 dark:border-border">
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-11 rounded-full text-zinc-500 dark:text-muted-foreground"
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-11 rounded-full text-zinc-500 dark:text-muted-foreground"
                    disabled={
                      !isMessagingAvailable ||
                      Boolean(blockReason) ||
                      isSending ||
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

              <p className="text-xs text-zinc-500 dark:text-muted-foreground">
                {draft.trim().length}/2000
              </p>
            </div>

            <Button
              type="submit"
              disabled={
                !isMessagingAvailable ||
                Boolean(blockReason) ||
                isSending ||
                (!draft.trim() && pendingAttachments.length === 0)
              }
              size="icon-lg"
              className="size-11 rounded-full"
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
