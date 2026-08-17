export const ADMIN_CONVERSATION_PAGE_SIZE = 25;
export const ADMIN_CONVERSATION_MESSAGE_PAGE_SIZE = 40;
export const ADMIN_CONVERSATION_MESSAGE_REQUEST_LIMIT =
  ADMIN_CONVERSATION_MESSAGE_PAGE_SIZE + 1;

export const ADMIN_CONVERSATION_FILTERS = Object.freeze([
  "all",
  "open",
  "closed",
  "reopened",
  "reported",
]);

export const ADMIN_CONVERSATION_ACTIONS = Object.freeze({
  close: "close",
  reopen: "reopen",
});

export const ADMIN_CONVERSATION_DURATIONS = Object.freeze([
  "24h",
  "7d",
  "30d",
  "permanent",
]);

export const ADMIN_CONVERSATION_REASON_CODES = Object.freeze([
  "spam",
  "scam",
  "harassment",
  "inappropriate",
  "prohibited",
  "other",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function codePointLength(value) {
  return Array.from(value).length;
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function normalizeAdminConversationFilter(value) {
  const filter = normalizeText(value).toLowerCase();
  return ADMIN_CONVERSATION_FILTERS.includes(filter) ? filter : "all";
}

export function normalizeAdminConversationSearch(value) {
  return normalizeText(value).slice(0, 100);
}

export function normalizeAdminConversationPage(value) {
  const page = Number.parseInt(String(value ?? "1"), 10);
  return Number.isFinite(page) ? Math.min(Math.max(page, 1), 1000) : 1;
}

export function validateAdminConversationCommand(input, role) {
  const action = normalizeText(input?.action).toLowerCase();
  const reasonCode = normalizeText(input?.reasonCode).toLowerCase();
  const userMessage = normalizeText(input?.userMessage);
  const internalNote = normalizeText(input?.internalNote);
  const duration = normalizeText(input?.duration).toLowerCase();
  const sourceReportId = normalizeText(input?.sourceReportId) || null;
  const operationId = normalizeText(input?.operationId);
  const expectedVersion = Number(input?.expectedVersion);
  const resolveSourceReport = input?.resolveSourceReport === true;

  if (!Object.values(ADMIN_CONVERSATION_ACTIONS).includes(action)) {
    return { ok: false, error: "action" };
  }

  if (!ADMIN_CONVERSATION_REASON_CODES.includes(reasonCode)) {
    return { ok: false, error: "reason_code" };
  }

  if (codePointLength(userMessage) < 10 || codePointLength(userMessage) > 1000) {
    return { ok: false, error: "user_message" };
  }

  if (internalNote && codePointLength(internalNote) > 2000) {
    return { ok: false, error: "internal_note" };
  }

  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return { ok: false, error: "expected_version" };
  }

  if (!isUuid(operationId)) {
    return { ok: false, error: "operation_id" };
  }

  if (sourceReportId && !isUuid(sourceReportId)) {
    return { ok: false, error: "source_report_id" };
  }

  if (resolveSourceReport && !sourceReportId) {
    return { ok: false, error: "resolve_source_report" };
  }

  if (action === ADMIN_CONVERSATION_ACTIONS.close) {
    if (!ADMIN_CONVERSATION_DURATIONS.includes(duration)) {
      return { ok: false, error: "duration" };
    }

    if (role !== "admin" && duration === "permanent") {
      return { ok: false, error: "permanent_forbidden" };
    }
  } else if (duration) {
    return { ok: false, error: "reopen_duration" };
  }

  return {
    ok: true,
    value: {
      action,
      reasonCode,
      userMessage,
      internalNote: internalNote || null,
      duration,
      sourceReportId,
      resolveSourceReport,
      operationId,
      expectedVersion,
    },
  };
}

function normalizeParticipant(row, prefix) {
  const firstName = row?.[`${prefix}_first_name`]?.trim() || "";
  const lastName = row?.[`${prefix}_last_name`]?.trim() || "";

  return {
    id: row?.[`${prefix}_id`] ?? null,
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(" "),
    school: row?.[`${prefix}_school`] ?? null,
    avatarPresetId: row?.[`${prefix}_avatar_preset_id`] ?? null,
    avatarUrl: row?.[`${prefix}_avatar_url`] ?? null,
  };
}

export function normalizeAdminConversationRegistryRow(row) {
  return {
    id: row.conversation_id,
    listing: {
      id: row.listing_id,
      slug: row.listing_slug,
      title: row.listing_title,
      status: row.listing_status,
    },
    buyer: normalizeParticipant(row, "buyer"),
    seller: normalizeParticipant(row, "seller"),
    moderationState: {
      version: Number(row.state_version ?? 0),
      recordedStatus: row.recorded_status ?? "open",
      effectiveStatus: row.effective_status ?? "open",
      closedUntil: row.closed_until ?? null,
      reasonCode: row.reason_code ?? null,
      userMessage: row.user_message ?? null,
      changedAt: row.changed_at ?? null,
      lastAction: row.last_action ?? null,
    },
    lastActivityAt: row.last_activity_at ?? null,
    lastMessagePreview: row.last_message_preview?.trim() || "",
    openReportCount: Number(row.open_report_count ?? 0),
    totalReportCount: Number(row.total_report_count ?? 0),
    registryTruncated: row.registry_truncated === true,
  };
}

export function normalizeAdminConversationMessagePage(rows) {
  const hasOlderMessages = rows.length > ADMIN_CONVERSATION_MESSAGE_PAGE_SIZE;
  const messages = rows
    .slice(0, ADMIN_CONVERSATION_MESSAGE_PAGE_SIZE)
    .reverse()
    .map((row) => {
      const firstName = row.sender_first_name?.trim() || "";
      const lastName = row.sender_last_name?.trim() || "";

      return {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        body: row.body ?? "",
        createdAt: row.created_at,
        sender: {
          id: row.sender_id,
          firstName,
          lastName,
          name: [firstName, lastName].filter(Boolean).join(" "),
          avatarPresetId: row.sender_avatar_preset_id ?? null,
          avatarUrl: row.sender_avatar_url ?? null,
        },
        attachments: Array.isArray(row.attachments) ? row.attachments : [],
        reactions: Array.isArray(row.reactions) ? row.reactions : [],
        reportCount: Number(row.report_count ?? 0),
      };
    });

  return { messages, hasOlderMessages };
}

export function buildAdminConversationRegistryHref({ filter, search, page }) {
  const params = new URLSearchParams();
  const normalizedFilter = normalizeAdminConversationFilter(filter);
  const normalizedSearch = normalizeAdminConversationSearch(search);
  const normalizedPage = normalizeAdminConversationPage(page);

  if (normalizedFilter !== "all") {
    params.set("filter", normalizedFilter);
  }

  if (normalizedSearch) {
    params.set("q", normalizedSearch);
  }

  if (normalizedPage > 1) {
    params.set("page", String(normalizedPage));
  }

  const query = params.toString();
  return query ? `/admin/conversations?${query}` : "/admin/conversations";
}
