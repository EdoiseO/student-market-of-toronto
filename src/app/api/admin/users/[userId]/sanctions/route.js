import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getUserModerationRole } from "@/lib/moderation";
import {
  BAN_REASON_MESSAGE_MAX_LENGTH,
  BAN_REASON_MESSAGE_MIN_LENGTH,
  MODERATION_ACTIONS,
  canPerformModerationAction,
  validateBanReason,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { getUserStatusRow, isUserBanned } from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["issue_warning", "issue_strike", "revoke", "uphold", "overturn"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function normalizeText(value, max = 1000) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, max + 1);
}

function validLength(value, min, max) {
  const length = Array.from(value).length;
  return length >= min && length <= max;
}

function permissionForAction(action, sanctionType = null) {
  if (action === "issue_warning") return MODERATION_ACTIONS.issueWarning;
  if (action === "issue_strike") return MODERATION_ACTIONS.issueStandardStrike;
  if (sanctionType === "ban") return MODERATION_ACTIONS.unbanUser;
  return sanctionType === "warning"
    ? MODERATION_ACTIONS.issueWarning
    : MODERATION_ACTIONS.issueStandardStrike;
}

async function findAuditResult(admin, { sanctionId, actorId, operationId, auditEventId = null }) {
  let query = admin
    .from("moderation_audit_events")
    .select("id, event_type, occurred_at")
    .eq("sanction_id", sanctionId)
    .eq("actor_user_id_snapshot", actorId)
    .eq("request_id", operationId);

  query = auditEventId
    ? query.eq("id", auditEventId)
    : query.eq("event_type", "sanction.request_recorded");

  const { data, error } = await query.single();
  if (error || !data) {
    console.error("Could not load exact moderation audit result:", error?.code ?? "unknown_error");
    throw new Error("moderation_audit_result_missing");
  }
  return data;
}

function firstRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

export async function POST(request, { params }) {
  try {
    const { userId } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || !ACTIONS.has(body.action)) {
      return NextResponse.json({ error: "Invalid moderation action." }, { status: 400 });
    }
    if (!UUID_PATTERN.test(userId)) {
      return NextResponse.json({ error: "Invalid target user." }, { status: 400 });
    }
    if (!UUID_PATTERN.test(body.operationId ?? "")) {
      return NextResponse.json({ error: "A valid operation id is required." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Moderation actions are not configured." }, { status: 503 });
    const supabase = createClient(await cookies());
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const accessUser = await getLatestAuthUser(admin, user.id, "sanction action access");
    if (!accessUser) return NextResponse.json({ error: "Could not verify moderation access." }, { status: 503 });
    const actorStatus = await getUserStatusRow(supabase, accessUser.id);
    if (actorStatus.available !== true || actorStatus.error) {
      return NextResponse.json({ error: "Could not verify account standing." }, { status: 503 });
    }
    if (isUserBanned(actorStatus.data)) {
      return NextResponse.json({ error: "Restricted accounts cannot take moderation actions." }, { status: 403 });
    }
    if (userId === accessUser.id) {
      return NextResponse.json({ error: "You cannot take this action on your own account." }, { status: 400 });
    }

    const actorRole = getUserModerationRole(accessUser);
    const targetUser = await getLatestAuthUser(admin, userId, "sanction action target");
    if (!targetUser) {
      return NextResponse.json({ error: "The target account could not be found." }, { status: 404 });
    }
    const targetRole = getUserModerationRole(targetUser);
    if (targetRole === "admin" || (actorRole === "moderator" && targetRole === "moderator")) {
      return NextResponse.json({ error: "This moderation account is protected." }, { status: 403 });
    }
    let sanction = null;
    if (["revoke", "uphold", "overturn"].includes(body.action)) {
      if (!UUID_PATTERN.test(body.sanctionId ?? "")) {
        return NextResponse.json({ error: "A valid sanction is required." }, { status: 400 });
      }
      const sanctionResult = await admin
        .from("moderation_sanctions")
        .select("id, subject_user_id_snapshot, sanction_type, review_status, revoked_at, expires_at, issued_by_role")
        .eq("id", body.sanctionId)
        .maybeSingle();
      if (sanctionResult.error || !sanctionResult.data) {
        return NextResponse.json({ error: "The sanction could not be found." }, { status: 404 });
      }
      sanction = sanctionResult.data;
      if (sanction.subject_user_id_snapshot !== userId) {
        return NextResponse.json({ error: "The sanction does not belong to this user." }, { status: 409 });
      }
      if (actorRole === "moderator" && sanction.issued_by_role === "admin") {
        return NextResponse.json(
          { error: "Only an administrator can change an administrator-issued sanction." },
          { status: 403 },
        );
      }
    }

    const permission = permissionForAction(body.action, sanction?.sanction_type);
    if (!canPerformModerationAction(actorRole, permission)) {
      return NextResponse.json({ error: "You do not have permission for this action." }, { status: 403 });
    }

    let sanctionId;
    let auditEventId = null;
    let replayed = false;
    if (body.action === "issue_warning" || body.action === "issue_strike") {
      if (!SEVERITIES.has(body.severity)) {
        return NextResponse.json({ error: "Choose a valid severity." }, { status: 400 });
      }
      const reason = validateBanReason({ reasonCode: body.reasonCode, userMessage: body.userMessage });
      if (!reason.ok) {
        return NextResponse.json({
          error: reason.error === "reason_code"
            ? "Choose a valid policy reason."
            : `Explain the action in ${BAN_REASON_MESSAGE_MIN_LENGTH}-${BAN_REASON_MESSAGE_MAX_LENGTH} characters.`,
        }, { status: 400 });
      }
      const strikePoints = Number.parseInt(body.strikePoints, 10);
      if (body.action === "issue_strike" && (!Number.isInteger(strikePoints) || strikePoints < 1 || strikePoints > 3)) {
        return NextResponse.json({ error: "Strike points must be between 1 and 3." }, { status: 400 });
      }
      if (
        body.action === "issue_strike" &&
        actorRole === "moderator" &&
        (strikePoints !== 1 || !["low", "medium"].includes(body.severity))
      ) {
        return NextResponse.json(
          { error: "Moderators can issue only a one-point low or medium standard strike." },
          { status: 403 },
        );
      }
      const functionName = body.action === "issue_warning" ? "issue_moderation_warning" : "issue_moderation_strike";
      const args = {
        p_subject_user_id: userId,
        p_severity: body.severity,
        p_reason_code: reason.reasonCode,
        p_user_message: reason.userMessage,
        p_internal_note: null,
        p_source_report_id: null,
        p_restrictions: {},
        p_related_resource_type: null,
        p_related_resource_id: null,
        p_expires_at: null,
        p_acknowledgement_required: true,
        p_request_id: body.operationId,
      };
      if (body.action === "issue_strike") args.p_strike_points = strikePoints;
      const rpcResult = await supabase.rpc(functionName, args);
      if (rpcResult.error) throw rpcResult.error;
      sanctionId = rpcResult.data;
    } else {
      if (body.action !== "revoke" && sanction.review_status !== "pending") {
        return NextResponse.json({ error: "Only a pending review can be decided." }, { status: 409 });
      }
      const outcomeMessage = body.action === "revoke" ? "" : normalizeText(body.outcomeMessage, 2000);
      if (body.action !== "revoke" && !validLength(outcomeMessage, 10, 2000)) {
        return NextResponse.json({ error: "Explain the review outcome in 10-2000 characters." }, { status: 400 });
      }
      const revocationReason = body.action === "uphold" ? "" : normalizeText(body.revocationReason);
      if (body.action !== "uphold" && !validLength(revocationReason, 10, 1000)) {
        return NextResponse.json({ error: body.action === "revoke" ? "Explain the revocation in 10-1000 characters." : "Explain the overturn in 10-1000 characters." }, { status: 400 });
      }
      const rpcResult = await supabase.rpc("execute_moderation_sanction_action", {
        p_sanction_id: sanction.id,
        p_action: body.action,
        p_outcome_message: outcomeMessage || null,
        p_revocation_reason: revocationReason || null,
        p_request_id: body.operationId,
      });
      if (rpcResult.error) throw rpcResult.error;
      const command = firstRow(rpcResult.data);
      if (!command?.sanction_id || !command?.audit_event_id) {
        throw new Error("moderation_sanction_action_result_invalid");
      }
      sanctionId = command.sanction_id;
      auditEventId = command.audit_event_id;
      replayed = command.replayed === true;
    }

    const audit = await findAuditResult(admin, {
      sanctionId,
      actorId: accessUser.id,
      operationId: body.operationId,
      auditEventId,
    });
    return NextResponse.json({
      success: true,
      sanctionId,
      auditEventId: audit.id,
      auditEventType: audit.event_type,
      auditOccurredAt: audit.occurred_at,
      replayed,
      notificationQueued: true,
    });
  } catch (error) {
    console.error("Failed to execute moderation action:", error?.message ?? error);
    return NextResponse.json({ error: "Could not complete the moderation action right now." }, { status: 500 });
  }
}
