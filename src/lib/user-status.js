export function isUserStatusTableMissing(error) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table 'public.user_status'")
  );
}

function getTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function isUserBanned(statusRow) {
  if (!statusRow?.is_banned) {
    return false;
  }

  const bannedUntilTimestamp = getTimestamp(statusRow?.banned_until);

  if (bannedUntilTimestamp === null) {
    return true;
  }

  return bannedUntilTimestamp > Date.now();
}

export async function getUserStatusRow(supabase, userId) {
  if (!supabase || !userId) {
    return { data: null, error: null };
  }

  const result = await supabase
    .from("user_status")
    .select("user_id, is_banned, banned_until, ban_reason, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (result.error && isUserStatusTableMissing(result.error)) {
    return { data: null, error: null, available: false };
  }

  return { ...result, available: true };
}
