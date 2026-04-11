"use client";

import * as React from "react";
import { UserX } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { getUserBlockState, isBlockedUsersTableMissing } from "@/lib/blocks";
import { createClient } from "@/utils/supabase/client";

export function BlockUserButton({
  currentUserId,
  targetUserId,
  className,
  onBlockStateChange,
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const { t } = useLanguage();
  const [blockState, setBlockState] = React.useState({
    blockedByCurrentUser: false,
    blockedCurrentUser: false,
    available: true,
  });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const isVisible = Boolean(currentUserId && targetUserId && currentUserId !== targetUserId);

  const refreshBlockState = React.useCallback(async () => {
    if (!isVisible) {
      return;
    }

    setIsLoading(true);
    const nextBlockState = await getUserBlockState(supabase, currentUserId, targetUserId);

    if (nextBlockState.error) {
      console.error("Failed to load block state:", nextBlockState.error.message);
    }

    setBlockState(nextBlockState);
    onBlockStateChange?.(nextBlockState);
    setIsLoading(false);
  }, [currentUserId, isVisible, onBlockStateChange, supabase, targetUserId]);

  React.useEffect(() => {
    refreshBlockState();
  }, [refreshBlockState]);

  if (!isVisible || !blockState.available) {
    return null;
  }

  async function handleUpdateBlockState() {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    const isBlocking = !blockState.blockedByCurrentUser;
    const operation = isBlocking
      ? supabase.from("blocked_users").insert({
          blocker_user_id: currentUserId,
          blocked_user_id: targetUserId,
        })
      : supabase
          .from("blocked_users")
          .delete()
          .eq("blocker_user_id", currentUserId)
          .eq("blocked_user_id", targetUserId);

    const { error } = await operation;

    if (error) {
      if (isBlockedUsersTableMissing(error)) {
        toast.error(t.blockUserUnavailable);
      } else {
        console.error("Failed to update block state:", error.message);
        toast.error(t.blockUserError);
      }
      setIsSubmitting(false);
      return;
    }

    await refreshBlockState();
    setIsSubmitting(false);
    toast.success(isBlocking ? t.blockUserSuccess : t.unblockUserSuccess);
  }

  const isBlocked = blockState.blockedByCurrentUser;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className={className} disabled={isLoading || isSubmitting}>
          <UserX className="size-4" />
          <span>{isBlocked ? t.unblockUser : t.blockUser}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isBlocked ? t.unblockUserTitle : t.blockUserTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {isBlocked ? t.unblockUserDescription : t.blockUserDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={handleUpdateBlockState} disabled={isSubmitting}>
            {isSubmitting ? t.saving : isBlocked ? t.unblockUser : t.blockUser}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
