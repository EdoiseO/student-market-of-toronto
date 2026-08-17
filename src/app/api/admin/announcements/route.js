import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ANNOUNCEMENT_PAGE_SIZE,
  buildAnnouncementTitle,
  isAnnouncementOperationId,
  normalizeAnnouncementRow,
  parseAnnouncementPage,
  parseAnnouncementStatus,
  validateAnnouncementPayload,
} from "@/lib/admin-announcements.mjs";
import {
  enqueueAnnouncementAudience,
  finalizeAnnouncementIfTerminal,
  runAnnouncementDeliveryWorker,
  runAnnouncementWorkerPass,
} from "@/lib/announcement-delivery-worker.mjs";
import { getUserModerationRole } from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { getUserStatusRow, isUserBanned } from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

const ANNOUNCEMENT_SELECT = `
  id,
  title,
  body,
  category,
  priority,
  audience_type,
  audience_filter,
  delivery_policy,
  email_enabled,
  status,
  scheduled_for,
  sending_started_at,
  sent_at,
  cancelled_at,
  recipient_count,
  delivered_count,
  failed_count,
  skipped_count,
  cancelled_count,
  read_count,
  dismissed_count,
  version,
  created_at,
  updated_at
`;

function json(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function firstRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

async function requireRpc(admin, name, args) {
  const { data, error } = await admin.rpc(name, args);

  if (error) {
    throw error;
  }

  return firstRow(data);
}

async function authorizeAnnouncementAdmin() {
  const admin = createAdminClient();

  if (!admin) {
    return { response: json({ error: "Announcements are not configured." }, 503) };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: json({ error: "You must be signed in." }, 401) };
  }

  const moderationUser = await getLatestAuthUser(admin, user.id, "announcement operation");
  const role = getUserModerationRole(moderationUser);

  if (!moderationUser) {
    return { response: json({ error: "Could not verify admin access." }, 503) };
  }
  if (!canPerformModerationAction(role, MODERATION_ACTIONS.manageAnnouncements)) {
    return { response: json({ error: "Admin role required." }, 403) };
  }

  const actorStatus = await getUserStatusRow(admin, moderationUser.id);
  if (actorStatus.error || actorStatus.available === false) {
    return { response: json({ error: "Could not verify admin access." }, 503) };
  }
  if (isUserBanned(actorStatus.data)) {
    return { response: json({ error: "Admin role required." }, 403) };
  }

  return { admin, moderationUser };
}

async function getAnnouncement(admin, announcementId) {
  const { data, error } = await admin
    .from("announcements")
    .select(ANNOUNCEMENT_SELECT)
    .eq("id", announcementId)
    .single();

  if (error || !data) {
    throw error ?? new Error("announcement_status_result_invalid");
  }

  return normalizeAnnouncementRow(data);
}

async function startBoundedDelivery(admin, announcementId) {
  const enqueue = await enqueueAnnouncementAudience({
    admin,
    announcementId,
    maxBatches: 1,
  });
  const worker = await runAnnouncementDeliveryWorker({
    admin,
    maxDeliveries: 10,
    maxLeaseReaps: 10,
  });
  const finalization = await finalizeAnnouncementIfTerminal({ admin, announcementId });

  return { enqueue, worker, finalization };
}

function operationErrorResponse(error) {
  const message = error?.message ?? "";

  if (/announcement_(?:version_conflict|operation_id_conflict)/i.test(message)) {
    return json({ error: "This announcement changed. Refresh and try again." }, 409);
  }
  if (
    /(?:invalid_announcement|only_.*announcement|announcement_has_no_terminal_failures|announcement_deliveries_are_not_terminal)/i.test(
      message,
    )
  ) {
    return json({ error: "This action is not available for the announcement's current state." }, 409);
  }

  return json({ error: "The announcement operation could not be completed." }, 500);
}

export async function GET(request) {
  const authorization = await authorizeAnnouncementAdmin();
  if (authorization.response) {
    return authorization.response;
  }

  const { admin } = authorization;
  const url = new URL(request.url);
  const page = parseAnnouncementPage(url.searchParams.get("page"));
  const status = parseAnnouncementStatus(url.searchParams.get("status"));
  const rawSearch = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const search = rawSearch.replace(/[%_,().]/g, " ").replace(/\s+/g, " ").trim();
  const from = (page - 1) * ANNOUNCEMENT_PAGE_SIZE;
  const to = from + ANNOUNCEMENT_PAGE_SIZE - 1;

  let query = admin
    .from("announcements")
    .select(ANNOUNCEMENT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (status) {
    query = query.eq("status", status);
  }
  if (search) {
    query = query.ilike("title", `%${search}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("Failed to list announcements:", error.message);
    return json({ error: "Announcements could not be loaded." }, 500);
  }

  return json({
    announcements: (data ?? []).map(normalizeAnnouncementRow),
    pagination: {
      page,
      pageSize: ANNOUNCEMENT_PAGE_SIZE,
      total: count ?? 0,
      totalPages: Math.max(1, Math.ceil((count ?? 0) / ANNOUNCEMENT_PAGE_SIZE)),
    },
    worker: {
      configured: Boolean(process.env.CRON_SECRET),
      emailAvailable: false,
    },
  });
}

export async function POST(request) {
  const authorization = await authorizeAnnouncementAdmin();
  if (authorization.response) {
    return authorization.response;
  }

  const { admin, moderationUser } = authorization;
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid request body." }, 400);
  }

  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  if (!["create_draft", "send"].includes(action)) {
    return json({ error: "Unsupported announcement action." }, 400);
  }
  const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
  if (!isAnnouncementOperationId(operationId)) {
    return json({ error: "A valid operation ID is required." }, 400);
  }

  const validation = validateAnnouncementPayload(
    action === "send" && body.message && !body.body
      ? { ...body, title: buildAnnouncementTitle(body.message), body: body.message }
      : body,
  );
  if (!validation.ok) {
    return json({ error: "Check the required announcement fields and audience." }, 400);
  }

  const payload = validation.value;

  try {
    const rpcName = action === "create_draft"
      ? "create_announcement_draft_idempotent"
      : "create_and_start_announcement";
    const announcement = await requireRpc(admin, rpcName, {
      p_operation_id: operationId,
      p_title: payload.title,
      p_body: payload.body,
      p_category: payload.category,
      p_priority: payload.priority,
      p_audience_type: payload.audienceType,
      p_audience_filter: payload.audienceFilter,
      p_delivery_policy: payload.deliveryPolicy,
      p_email_enabled: false,
      p_actor_id: moderationUser.id,
    });

    if (!announcement?.id) {
      throw new Error("announcement_operation_result_invalid");
    }

    let delivery = null;
    if (action === "send" && announcement.status === "sending") {
      delivery = await startBoundedDelivery(admin, announcement.id);
    }

    const latest = await getAnnouncement(admin, announcement.id);
    return json({
      announcement: latest,
      operationId,
      queued: latest.status === "sending",
      noRecipients:
        delivery?.enqueue?.exhausted === true && latest.recipientCount === 0,
      worker: delivery?.worker ?? null,
      announcementId: latest.id,
      sentCount: latest.deliveredCount,
      totalRecipients: latest.recipientCount,
      failureCount: latest.failedCount,
    });
  } catch (error) {
    console.error("Announcement create/send failed:", error?.message ?? error);
    return operationErrorResponse(error);
  }
}

export async function PATCH(request) {
  const authorization = await authorizeAnnouncementAdmin();
  if (authorization.response) {
    return authorization.response;
  }

  const { admin, moderationUser } = authorization;
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid request body." }, 400);
  }

  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
  if (!isAnnouncementOperationId(operationId)) {
    return json({ error: "A valid operation ID is required." }, 400);
  }

  if (action === "run_worker") {
    try {
      const worker = await runAnnouncementWorkerPass({
        admin,
        maxAnnouncements: 5,
        maxDeliveries: 25,
        maxLeaseReaps: 25,
        maxScheduledActivations: 10,
      });
      return json({ worker });
    } catch (error) {
      console.error("Manual announcement worker pass failed:", error?.message ?? error);
      return json({ error: "The delivery worker could not complete this pass." }, 500);
    }
  }

  const announcementId = typeof body.announcementId === "string"
    ? body.announcementId.trim()
    : "";
  const expectedVersion = Number.parseInt(body.expectedVersion, 10);
  if (!isAnnouncementOperationId(announcementId) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return json({ error: "A valid announcement and version are required." }, 400);
  }

  try {
    let commandPayload = {};

    if (action === "update_draft") {
      const validation = validateAnnouncementPayload(body);
      if (!validation.ok) {
        return json({ error: "Check the required announcement fields and audience." }, 400);
      }
      const payload = validation.value;
      commandPayload = {
        title: payload.title,
        body: payload.body,
        category: payload.category,
        priority: payload.priority,
        audience_type: payload.audienceType,
        audience_filter: payload.audienceFilter,
        delivery_policy: payload.deliveryPolicy,
        email_enabled: false,
      };
    } else if (action === "schedule") {
      const parsedDate = new Date(body.scheduledFor);
      if (!Number.isFinite(parsedDate.getTime()) || parsedDate.getTime() <= Date.now()) {
        return json({ error: "Choose a future schedule time." }, 400);
      }
      commandPayload = { scheduled_for: parsedDate.toISOString() };
    } else if (!["unschedule", "send", "cancel", "retry"].includes(action)) {
      return json({ error: "Unsupported announcement action." }, 400);
    }

    const command = await requireRpc(admin, "execute_announcement_lifecycle_command", {
      p_operation_id: operationId,
      p_announcement_id: announcementId,
      p_expected_version: expectedVersion,
      p_action: action,
      p_actor_id: moderationUser.id,
      p_payload: commandPayload,
    });
    const announcement = command?.announcement;

    if (!announcement?.id || !command?.audit_event_id) {
      throw new Error("announcement_operation_result_invalid");
    }

    // A replay may be the retry after an ambiguous response that happened
    // before the bounded delivery kick-off. Enqueue/claim are independently
    // idempotent, so safely continue the same campaign on every replay.
    if (["send", "retry"].includes(action) && announcement.status === "sending") {
      await startBoundedDelivery(admin, announcementId);
    }

    return json({
      announcement: await getAnnouncement(admin, announcementId),
      operationId,
      auditEventId: command.audit_event_id,
      replayed: command.replayed === true,
    });
  } catch (error) {
    console.error("Announcement lifecycle operation failed:", error?.message ?? error);
    return operationErrorResponse(error);
  }
}
