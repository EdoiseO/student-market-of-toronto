"use client";

import * as React from "react";
import { Ellipsis, Flag, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";

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
import { ReportSheet } from "@/components/report-sheet";
import { useLanguage } from "@/context/LanguageContext";
import { getUserBlockState, isBlockedUsersTableMissing } from "@/lib/blocks";
import { REPORT_SUBJECT_TYPES } from "@/lib/moderation";
import { createClient } from "@/utils/supabase/client";

export function ProfileReportButton({ profileId, currentUserId = null }) {
  const supabase = React.useMemo(() => createClient(), []);
  const { t } = useLanguage();
  const [blockState, setBlockState] = React.useState({
    blockedByCurrentUser: false,
    blockedCurrentUser: false,
    available: true,
  });
  const [isLoadingBlockState, setIsLoadingBlockState] = React.useState(true);
  const [isSubmittingBlock, setIsSubmittingBlock] = React.useState(false);
  const [isBlockDialogOpen, setIsBlockDialogOpen] = React.useState(false);
  const [isReportSheetOpen, setIsReportSheetOpen] = React.useState(false);

  const isVisible = Boolean(currentUserId && profileId && currentUserId !== profileId);

  const refreshBlockState = React.useCallback(async () => {
    if (!isVisible) return;
    setIsLoadingBlockState(true);
    const nextBlockState = await getUserBlockState(supabase, currentUserId, profileId);
    if (nextBlockState.error) {
      console.error("Failed to load profile block state:", nextBlockState.error.message);
    }
    setBlockState(nextBlockState);
    setIsLoadingBlockState(false);
  }, [currentUserId, isVisible, profileId, supabase]);

  React.useEffect(() => {
    refreshBlockState();
  }, [refreshBlockState]);

  if (!isVisible || !blockState.available) {
    return null;
  }

  async function handleUpdateBlockState() {
    if (isSubmittingBlock) return;

    setIsSubmittingBlock(true);

    const isBlocking = !blockState.blockedByCurrentUser;
    const operation = isBlocking
      ? supabase.from("blocked_users").insert({
          blocker_user_id: currentUserId,
          blocked_user_id: profileId,
        })
      : supabase
          .from("blocked_users")
          .delete()
          .eq("blocker_user_id", currentUserId)
          .eq("blocked_user_id", profileId);

    const { error } = await operation;

    if (error) {
      if (isBlockedUsersTableMissing(error)) {
        toast.error(t.blockUserUnavailable);
      } else {
        console.error("Failed to update block state:", error.message);
        toast.error(t.blockUserError);
      }
      setIsSubmittingBlock(false);
      return;
    }

    await refreshBlockState();
    setIsSubmittingBlock(false);
    setIsBlockDialogOpen(false);
    toast.success(isBlocking ? t.blockUserSuccess : t.unblockUserSuccess);
  }

  const isBlocked = blockState.blockedByCurrentUser;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t.moreActions}
            disabled={isLoadingBlockState}
            className="size-11 rounded-xl border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
          >
            <Ellipsis className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 rounded-2xl">
          <DropdownMenuItem onClick={() => setIsBlockDialogOpen(true)}>
            {isBlocked ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
            <span>{isBlocked ? t.unblockUser : t.blockUser}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsReportSheetOpen(true)}>
            <Flag className="size-4" />
            <span>{t.reportProfile}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isBlockDialogOpen} onOpenChange={setIsBlockDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isBlocked ? t.unblockUserTitle : t.blockUserTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isBlocked ? t.unblockUserDescription : t.blockUserDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmittingBlock}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUpdateBlockState}
              disabled={isSubmittingBlock}
            >
              {isSubmittingBlock ? t.saving : isBlocked ? t.unblockUser : t.blockUser}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReportSheet
        open={isReportSheetOpen}
        onOpenChange={setIsReportSheetOpen}
        subjectType={REPORT_SUBJECT_TYPES.profile}
        subjectId={profileId}
        currentUserId={currentUserId}
        reportedUserId={profileId}
      />
    </>
  );
}
