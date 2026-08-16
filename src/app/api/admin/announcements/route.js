import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  enqueueAnnouncementAudience,
  finalizeAnnouncementIfTerminal,
  runAnnouncementDeliveryWorker,
} from "@/lib/announcement-delivery-worker.mjs";
import { getUserModerationRole } from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
  validateAnnouncementMessage,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

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

function buildAnnouncementTitle(message) {
  const compactMessage = message.replace(/\s+/g, " ").trim();
  const characters = Array.from(compactMessage);

  return characters.length > 80
    ? `${characters.slice(0, 79).join("")}\u2026`
    : compactMessage;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request) {
  try {
    const admin = createAdminClient();

    if (!admin) {
      return NextResponse.json(
        { error: "Announcements are not configured in this environment." },
        { status: 503 },
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const moderationUser = await getLatestAuthUser(admin, user.id, "announcement send");

    if (!moderationUser) {
      return NextResponse.json(
        { error: "Could not verify your current admin access." },
        { status: 503 },
      );
    }

    if (
      !canPerformModerationAction(
        getUserModerationRole(moderationUser),
        MODERATION_ACTIONS.manageAnnouncements,
      )
    ) {
      return NextResponse.json({ error: "Admin role required." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validatedMessage = validateAnnouncementMessage(body.message);

    if (!validatedMessage.ok) {
      return NextResponse.json(
        { error: "Message must be between 1 and 2000 characters." },
        { status: 400 },
      );
    }

    const operationId = typeof body.operationId === "string"
      ? body.operationId.trim()
      : "";

    if (!UUID_PATTERN.test(operationId)) {
      return NextResponse.json(
        { error: "A valid announcement operation ID is required." },
        { status: 400 },
      );
    }

    const sending = await requireRpc(admin, "create_and_start_announcement", {
      p_operation_id: operationId,
      p_title: buildAnnouncementTitle(validatedMessage.message),
      p_body: validatedMessage.message,
      p_category: "general",
      p_priority: "normal",
      p_audience_type: "all",
      p_audience_filter: {},
      p_delivery_policy: "always_on",
      // No provider worker is tracked in this repository. Email remains
      // disabled until that separately authenticated dependency is deployed.
      p_email_enabled: false,
      p_actor_id: moderationUser.id,
    });

    if (!sending?.id || !["sending", "sent", "partially_failed"].includes(sending.status)) {
      throw new Error("announcement_create_start_result_invalid");
    }

    let enqueueResult = { exhausted: true, enqueuedCount: 0 };
    let workerResult = { claimedCount: 0, deliveredCount: 0, failedCount: 0 };

    if (sending.status === "sending") {
      enqueueResult = await enqueueAnnouncementAudience({
        admin,
        announcementId: sending.id,
        maxBatches: 1,
      });
      workerResult = await runAnnouncementDeliveryWorker({
        admin,
        maxDeliveries: 10,
        maxLeaseReaps: 10,
      });
      await finalizeAnnouncementIfTerminal({ admin, announcementId: sending.id });
    }
    const { data: latestAnnouncement, error: latestAnnouncementError } = await admin
      .from("announcements")
      .select("id, version, status, recipient_count, delivered_count, failed_count")
      .eq("id", sending.id)
      .single();

    if (latestAnnouncementError || !latestAnnouncement) {
      throw latestAnnouncementError ?? new Error("announcement_status_result_invalid");
    }

    const totalRecipients = Number(latestAnnouncement.recipient_count ?? 0);
    const sentCount = Number(latestAnnouncement.delivered_count ?? 0);
    const failureCount = Number(latestAnnouncement.failed_count ?? 0);
    const deliveryFinished = ["sent", "partially_failed"].includes(latestAnnouncement.status);

    return NextResponse.json({
      announcementId: latestAnnouncement.id,
      operationId,
      sentCount,
      totalRecipients,
      failureCount,
      noRecipients: enqueueResult.exhausted && totalRecipients === 0,
      queued: !deliveryFinished,
      worker: {
        claimedCount: workerResult.claimedCount,
        deliveredCount: workerResult.deliveredCount,
        failedCount: workerResult.failedCount,
      },
    });
  } catch (error) {
    console.error("Failed to send announcement:", error?.message ?? error);
    return NextResponse.json(
      { error: "Could not send the announcement right now." },
      { status: 500 },
    );
  }
}
