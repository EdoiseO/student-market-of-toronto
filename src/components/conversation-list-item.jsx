"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ellipsis, Eye, EyeOff, LockKeyhole, Megaphone, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/context/LanguageContext";
import { isConversationEffectivelyClosed } from "@/lib/conversation-moderation.mjs";
import {
  isConversationUserStateDeletedAtColumnMissing,
  isConversationUserStateTableMissing,
} from "@/lib/messages";
import { createClient } from "@/utils/supabase/client";

export function ConversationListItem({ conversation, dateValue, showHidden = false }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const [isUpdatingVisibility, setIsUpdatingVisibility] = React.useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [isDeletingConversation, setIsDeletingConversation] = React.useState(false);

  async function handleUpdateConversationVisibility(hiddenAt) {
    if (isUpdatingVisibility) {
      return;
    }

    setIsUpdatingVisibility(true);

    const { error } = await supabase.from("conversation_user_state").upsert(
      {
        conversation_id: conversation.id,
        user_id: conversation.currentParticipant.id,
        hidden_at: hiddenAt,
      },
      { onConflict: "conversation_id,user_id" },
    );

    if (error) {
      if (!isConversationUserStateTableMissing(error)) {
        console.error("Failed to update conversation visibility:", error.message);
      }
      toast.error(showHidden ? t.restoreConversationError : t.hideConversationError);
      setIsUpdatingVisibility(false);
      return;
    }

    setIsUpdatingVisibility(false);
    router.refresh();
  }

  async function handleHideConversation() {
    return handleUpdateConversationVisibility(new Date().toISOString());
  }

  async function handleRestoreConversation() {
    return handleUpdateConversationVisibility(null);
  }

  async function handleDeleteConversation() {
    if (isDeletingConversation) {
      return;
    }

    setIsDeletingConversation(true);

    const { error } = await supabase.from("conversation_user_state").upsert(
      {
        conversation_id: conversation.id,
        user_id: conversation.currentParticipant.id,
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
      }
      toast.error(t.deleteConversationError);
      setIsDeletingConversation(false);
      return;
    }

    setIsDeletingConversation(false);
    setIsDeleteDialogOpen(false);
    router.refresh();
  }

  const conversationHref = `/messages/${conversation.id}`;
  const displayName = conversation.isAnnouncement
    ? t.announcements
    : conversation.otherParticipant.name;
  const preview = conversation.lastMessagePreview || t.conversationNoMessagesYet;
  const isConversationClosed =
    !conversation.isAnnouncement &&
    isConversationEffectivelyClosed(conversation.moderationState);

  return (
    <div
      className={`flex min-w-0 items-center border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/40 md:px-6 ${
        conversation.unreadCount > 0 ? "bg-muted/30" : "bg-card"
      }`}
    >
      <Link
        href={conversationHref}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
          {conversation.isAnnouncement ? (
            <Megaphone className="size-5" />
          ) : (
            <ProfileAvatar
              name={conversation.otherParticipant.name}
              avatarPresetId={conversation.otherParticipant.avatarPresetId}
              avatarUrl={conversation.otherParticipant.avatarUrl}
              className="size-11 border border-border"
            />
          )}
        </div>

        <div className="min-w-0 flex-1 py-0.5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p
              className={`truncate text-sm text-foreground ${
                conversation.unreadCount > 0 ? "font-semibold" : "font-medium"
              }`}
            >
              {displayName}
            </p>

            <div className="flex shrink-0 items-center gap-2">
              {conversation.unreadCount > 0 ? (
                <Badge className="min-w-5 justify-center rounded-full bg-foreground px-1.5 py-0 text-xs text-background shadow-none">
                  {conversation.unreadCount}
                </Badge>
              ) : null}
              <ClientFormattedDateTime
                value={dateValue}
                language={language}
                variant="date"
                className="text-xs text-muted-foreground"
              />
            </div>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            {isConversationClosed ? (
              <Badge
                variant="secondary"
                className="h-5 shrink-0 gap-1 rounded-full px-1.5 text-[0.625rem] font-semibold uppercase tracking-wide"
              >
                <LockKeyhole className="size-3" aria-hidden="true" />
                {t.conversationClosedBadge}
              </Badge>
            ) : null}
            <p
              className={`min-w-0 truncate text-sm ${
                conversation.unreadCount > 0 ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {!conversation.isAnnouncement ? (
                <>
                  <span className="font-medium">{conversation.listing.title}</span>
                  <span aria-hidden="true"> · </span>
                </>
              ) : null}
              {preview}
            </p>
          </div>
        </div>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t.moreActions}
            disabled={isUpdatingVisibility || isDeletingConversation}
            className="ml-1 size-11 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 rounded-2xl">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              if (showHidden) {
                handleRestoreConversation();
                return;
              }

              handleHideConversation();
            }}
            disabled={isUpdatingVisibility || isDeletingConversation}
          >
            {showHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            <span>{showHidden ? t.restoreConversation : t.hideConversation}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setIsDeleteDialogOpen(true);
            }}
            disabled={isUpdatingVisibility || isDeletingConversation}
          >
            <Trash2 className="size-4" />
            <span>{t.deleteConversation}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteConversationTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteConversationDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingConversation}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConversation} disabled={isDeletingConversation}>
              {isDeletingConversation ? t.saving : t.deleteConversation}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
