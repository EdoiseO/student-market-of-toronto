export function isBlockedUsersTableMissing(error) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table 'public.blocked_users'")
  );
}

export async function getUserBlockState(supabase, currentUserId, otherUserId) {
  if (!supabase || !currentUserId || !otherUserId || currentUserId === otherUserId) {
    return {
      blockedByCurrentUser: false,
      blockedCurrentUser: false,
      available: true,
      error: null,
    };
  }

  const [blockedByCurrentUserResult, blockedCurrentUserResult] = await Promise.all([
    supabase
      .from("blocked_users")
      .select("blocker_user_id")
      .eq("blocker_user_id", currentUserId)
      .eq("blocked_user_id", otherUserId)
      .maybeSingle(),
    supabase
      .from("blocked_users")
      .select("blocker_user_id")
      .eq("blocker_user_id", otherUserId)
      .eq("blocked_user_id", currentUserId)
      .maybeSingle(),
  ]);

  const firstError = blockedByCurrentUserResult.error;
  const secondError = blockedCurrentUserResult.error;

  if (firstError || secondError) {
    const tableMissingError =
      isBlockedUsersTableMissing(firstError) || isBlockedUsersTableMissing(secondError);

    if (tableMissingError) {
      return {
        blockedByCurrentUser: false,
        blockedCurrentUser: false,
        available: false,
        error: null,
      };
    }

    return {
      blockedByCurrentUser: false,
      blockedCurrentUser: false,
      available: true,
      error: firstError ?? secondError,
    };
  }

  return {
    blockedByCurrentUser: Boolean(blockedByCurrentUserResult.data),
    blockedCurrentUser: Boolean(blockedCurrentUserResult.data),
    available: true,
    error: null,
  };
}

export function getMessagingBlockReason(blockState, t) {
  if (blockState?.blockedByCurrentUser) {
    return t.messagingBlockedByYou;
  }

  if (blockState?.blockedCurrentUser) {
    return t.messagingBlockedByOtherUser;
  }

  return null;
}
