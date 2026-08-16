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

function getComparisonTimestamp(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  return getTimestamp(value);
}

// Supabase represents this app's "permanent" ban as a 100-year duration.
// Treat anything at least 99 years away as permanent in user-facing copy.
const PERMANENT_BAN_DISPLAY_THRESHOLD_MS = 99 * 365 * 24 * 60 * 60 * 1000;

export function getBanDisplayUntil(bannedUntil, now = Date.now()) {
  const bannedUntilTimestamp = getTimestamp(bannedUntil);
  const nowTimestamp = getComparisonTimestamp(now);

  if (
    bannedUntilTimestamp === null ||
    nowTimestamp === null ||
    bannedUntilTimestamp - nowTimestamp >= PERMANENT_BAN_DISPLAY_THRESHOLD_MS
  ) {
    return null;
  }

  return bannedUntil;
}

export function isAuthUserBanned(authUser, now = Date.now()) {
  const bannedUntilTimestamp = getTimestamp(authUser?.banned_until);
  const nowTimestamp = getComparisonTimestamp(now);

  return (
    bannedUntilTimestamp !== null &&
    nowTimestamp !== null &&
    bannedUntilTimestamp > nowTimestamp
  );
}

export function isUserBanned(statusRow, now = Date.now()) {
  if (!statusRow?.is_banned) {
    return false;
  }

  const bannedUntilTimestamp = getTimestamp(statusRow?.banned_until);

  if (bannedUntilTimestamp === null) {
    return true;
  }

  const nowTimestamp = getComparisonTimestamp(now);
  return nowTimestamp !== null && bannedUntilTimestamp > nowTimestamp;
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
