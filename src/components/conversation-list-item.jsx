"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ellipsis, Trash2 } from "lucide-react";
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
  AlertDialogTrigger,
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
import { isConversationUserStateTableMissing } from "@/lib/messages";
import { createClient } from "@/utils/supabase/client";

export function ConversationListItem({ conversation, dateValue }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();

  async function handleHideConversation() {
    const { error } = await supabase.from("conversation_user_state").upsert(
      {
        conversation_id: conversation.id,
        user_id: conversation.currentParticipant.id,
        hidden_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id,user_id" },
    );

    if (error) {
      if (!isConversationUserStateTableMissing(error)) {
        console.error("Failed to hide conversation:", error.message);
      }
      toast.error(t.hideConversationError);
      return;
    }

    router.refresh();
  }

  return (
    <div className="rounded-[1.5rem] border border-zinc-200 bg-white p-4 transition hover:bg-background dark:border-border dark:bg-card dark:hover:bg-background">
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
            <Link href={`/messages/${conversation.id}`} className="min-w-0 flex-1">
              <div className="min-w-0">
                <p className="truncate font-semibold text-zinc-950 dark:text-foreground">
                  {conversation.listing.title}
                </p>
                <p className="truncate text-sm text-zinc-500 dark:text-muted-foreground">
                  {conversation.otherParticipant.name}
                </p>
              </div>
            </Link>

            <div className="flex shrink-0 items-center gap-2">
              {conversation.unreadCount > 0 ? (
                <Badge className="rounded-full bg-blue-500 px-2.5 py-0.5 text-white ring-2 ring-background shadow-[0_0_12px_rgba(59,130,246,0.95)]">
                  {conversation.unreadCount}
                </Badge>
              ) : null}
              <ClientFormattedDateTime
                value={dateValue}
                language={language}
                variant="date"
                className="text-xs text-zinc-500 dark:text-muted-foreground"
              />

              <AlertDialog>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={t.moreActions}
                      className="rounded-full border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                    >
                      <Ellipsis className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 rounded-2xl">
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                        <Trash2 className="size-4" />
                        <span>{t.hideConversation}</span>
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                  </DropdownMenuContent>
                </DropdownMenu>

                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t.hideConversationTitle}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t.hideConversationDescription}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleHideConversation}>
                      {t.hideConversation}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <Link href={`/messages/${conversation.id}`} className="block">
            <p className="mt-3 line-clamp-2 text-sm text-zinc-600 dark:text-muted-foreground">
              {conversation.lastMessagePreview || t.conversationNoMessagesYet}
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
