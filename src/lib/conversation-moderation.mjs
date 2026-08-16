export const CONVERSATION_MODERATION_STATE_SELECT = `
  conversation_id,
  version,
  recorded_status,
  effective_status,
  closed_until,
  reason_code,
  user_message,
  changed_at
`;

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeConversationModerationState(row) {
  if (!row?.conversation_id) {
    return null;
  }

  return {
    conversationId: row.conversation_id,
    version: Number(row.version ?? 0),
    recordedStatus: row.recorded_status ?? "open",
    effectiveStatus: row.effective_status ?? "open",
    closedUntil: row.closed_until ?? null,
    reasonCode: row.reason_code ?? null,
    userMessage: row.user_message?.trim() || null,
    changedAt: row.changed_at ?? null,
  };
}

export function isConversationEffectivelyClosed(state, now = Date.now()) {
  if (!state || state.recordedStatus !== "closed") {
    return false;
  }

  const closedUntil = parseTimestamp(state.closedUntil);

  return closedUntil === null ? state.closedUntil === null : closedUntil > now;
}

export function getConversationClosureExpiryDelay(state, now = Date.now()) {
  if (state?.recordedStatus !== "closed" || !state.closedUntil) {
    return null;
  }

  const closedUntil = parseTimestamp(state.closedUntil);
  return closedUntil === null ? null : Math.max(0, closedUntil - now);
}

export function isConversationClosedWriteError(error) {
  return [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes("conversation_write_closed");
}
