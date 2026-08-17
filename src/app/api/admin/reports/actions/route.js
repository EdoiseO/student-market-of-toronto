import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  isModerationRole,
  getUserModerationRole,
  REPORT_STATUS_VALUES,
} from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import {
  REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY,
  REJECTED_PROFILE_NAME_FINGERPRINT_KEY,
  appendRejectedProfileNameFingerprint,
  areOpenProfileReportsBoundToUser,
  getProfileNameFingerprint,
} from "@/lib/name-sanction.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import {
  validateForceNameDecision,
  validateModeratorNote,
  validateModeratorNoteEntry,
  validateReportDecisionSummary,
  validateReportedListingDecision,
} from "@/lib/write-field-contracts.mjs";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isModerationWriteConflict(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return error?.code === "40001" || message.includes("moderation_report_set_conflict");
}

async function requireModerationUser() {
  const admin = createAdminClient();

  if (!admin) {
    return {
      errorResponse: NextResponse.json(
        { error: "Moderation actions are not configured in this environment." },
        { status: 503 },
      ),
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      errorResponse: NextResponse.json({ error: "You must be signed in." }, { status: 401 }),
    };
  }

  const moderationUser = await getLatestAuthUser(admin, user.id, "moderation actions");

  if (!moderationUser) {
    return {
      errorResponse: NextResponse.json(
        { error: "Could not verify your moderation access." },
        { status: 503 },
      ),
    };
  }

  if (!isModerationRole(getUserModerationRole(moderationUser))) {
    return {
      errorResponse: NextResponse.json(
        { error: "Only moderation users can perform this action." },
        { status: 403 },
      ),
    };
  }

  return { admin, supabase, user: moderationUser };
}

export async function POST(request) {
  try {
    const moderationContext = await requireModerationUser();

    if (moderationContext.errorResponse) {
      return moderationContext.errorResponse;
    }

    const { admin, supabase, user } = moderationContext;
    const payload = await request.json();
    const action = payload?.action;
    const moderationRole = getUserModerationRole(user);

    const requireAction = (requiredAction, message) => {
      if (canPerformModerationAction(moderationRole, requiredAction)) {
        return null;
      }

      return NextResponse.json({ error: message }, { status: 403 });
    };

    if (action === "update_status") {
      const permissionError = requireAction(
        MODERATION_ACTIONS.decideReports,
        "Report decision permission required.",
      );

      if (permissionError) {
        return permissionError;
      }

      const reportIds = Array.isArray(payload?.reportIds)
        ? [...new Set(payload.reportIds.filter(Boolean))]
        : [];
      const nextStatus = payload?.status;
      const operationId =
        typeof payload?.operationId === "string" ? payload.operationId.trim() : "";
      const decisionSummaryResult = validateReportDecisionSummary(payload?.decisionSummary);

      if (!reportIds.length || !UUID_PATTERN.test(operationId) || !decisionSummaryResult.ok) {
        return NextResponse.json({ error: "Missing report ids." }, { status: 400 });
      }

      if (
        nextStatus !== REPORT_STATUS_VALUES.resolved &&
        nextStatus !== REPORT_STATUS_VALUES.dismissed
      ) {
        return NextResponse.json({ error: "Unsupported report status." }, { status: 400 });
      }

      const { data: updatedCount, error } = await supabase.rpc("decide_report_set_with_summary", {
        p_report_ids: reportIds,
        p_status: nextStatus,
        p_private_summary: decisionSummaryResult.value,
        p_request_id: operationId,
      });

      if (isModerationWriteConflict(error)) {
        return NextResponse.json(
          { error: "The selected reports changed or do not belong to one open subject." },
          { status: 409 },
        );
      }

      if (error) {
        throw error;
      }

      return NextResponse.json({ success: true, updatedCount });
    }

    if (action === "remove_listing") {
      const reportPermissionError = requireAction(
        MODERATION_ACTIONS.decideReports,
        "Report decision permission required.",
      );
      const listingPermissionError = requireAction(
        MODERATION_ACTIONS.decideListings,
        "Listing decision permission required.",
      );

      if (reportPermissionError || listingPermissionError) {
        return reportPermissionError ?? listingPermissionError;
      }

      const reportIds = Array.isArray(payload?.reportIds)
        ? [...new Set(payload.reportIds.filter(Boolean))]
        : [];
      const listingId = payload?.listingId;
      const operationId =
        typeof payload?.operationId === "string" ? payload.operationId.trim() : "";
      const decisionResult = validateReportedListingDecision({
        sellerFeedback: payload?.sellerFeedback,
        privateSummary: payload?.privateSummary,
      });

      if (
        !reportIds.length ||
        !listingId ||
        !UUID_PATTERN.test(operationId) ||
        !decisionResult.ok
      ) {
        return NextResponse.json({ error: "Missing listing moderation payload." }, { status: 400 });
      }

      const { data: updatedCount, error } = await supabase.rpc(
        "remove_reported_listing_with_rationale",
        {
          p_report_ids: reportIds,
          p_listing_id: listingId,
          p_seller_feedback: decisionResult.value.sellerFeedback,
          p_private_summary: decisionResult.value.privateSummary,
          p_request_id: operationId,
        },
      );

      if (isModerationWriteConflict(error)) {
        return NextResponse.json(
          { error: "The listing or selected open reports changed before removal." },
          { status: 409 },
        );
      }

      if (error) {
        throw error;
      }

      return NextResponse.json({ success: true, updatedCount });
    }

    if (action === "force_name_change") {
      const permissionError = requireAction(
        MODERATION_ACTIONS.decideReports,
        "Report decision permission required.",
      );

      if (permissionError) {
        return permissionError;
      }

      if (moderationRole !== "admin") {
        return NextResponse.json(
          { error: "Only admins can require a name change." },
          { status: 403 },
        );
      }

      const reportIds = Array.isArray(payload?.reportIds)
        ? [...new Set(payload.reportIds.filter(Boolean))]
        : [];
      const targetUserId = payload?.userId;
      const operationId =
        typeof payload?.operationId === "string" ? payload.operationId.trim() : "";
      const forceNameDecision = validateForceNameDecision({
        policyReason: payload?.policyReason,
        userMessage: payload?.userMessage,
        privateNote: payload?.privateNote,
      });

      if (
        !reportIds.length ||
        !targetUserId ||
        !UUID_PATTERN.test(operationId) ||
        !forceNameDecision.ok
      ) {
        return NextResponse.json(
          { error: "Missing name change moderation payload." },
          { status: 400 },
        );
      }

      const { data: reportRows, error: reportLookupError } = await admin
        .from("reports")
        .select("id, subject_type, subject_id, reported_user_id, status")
        .in("id", reportIds);

      if (reportLookupError) {
        throw reportLookupError;
      }

      if (!areOpenProfileReportsBoundToUser(reportRows, reportIds, targetUserId)) {
        return NextResponse.json(
          { error: "Every selected open profile report must belong to this user." },
          { status: 409 },
        );
      }

      const {
        data: { user: targetUser },
        error: targetUserError,
      } = await admin.auth.admin.getUserById(targetUserId);

      if (targetUserError || !targetUser) {
        throw targetUserError ?? new Error("Target user not found.");
      }

      if (getUserModerationRole(targetUser) === "admin") {
        return NextResponse.json(
          { error: "Admin accounts cannot be forced to change their name from this screen." },
          { status: 400 },
        );
      }

      const { data: targetProfile, error: targetProfileError } = await admin
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", targetUserId)
        .maybeSingle();

      if (targetProfileError) {
        throw targetProfileError;
      }

      const requestId = operationId;
      const rejectedNameFingerprint = getProfileNameFingerprint(
        targetProfile?.first_name,
        targetProfile?.last_name,
      );
      const rejectedNameFingerprints = appendRejectedProfileNameFingerprint(
        targetUser.app_metadata,
        rejectedNameFingerprint,
      );
      const nextAppMetadata = {
        ...(targetUser.app_metadata ?? {}),
        force_name_change: true,
      };

      if (rejectedNameFingerprint) {
        nextAppMetadata[REJECTED_PROFILE_NAME_FINGERPRINT_KEY] = rejectedNameFingerprint;
      }

      if (rejectedNameFingerprints.length > 0) {
        nextAppMetadata[REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY] =
          rejectedNameFingerprints;
      }

      const { data: operationRows, error: beginError } = await supabase.rpc(
        "begin_force_name_operation_with_rationale",
        {
          p_report_ids: reportIds,
          p_subject_user_id: targetUserId,
          p_desired_metadata: nextAppMetadata,
          p_rollback_metadata: targetUser.app_metadata ?? {},
          p_policy_reason: forceNameDecision.value.policyReason,
          p_user_message: forceNameDecision.value.userMessage,
          p_private_note: forceNameDecision.value.privateNote,
          p_request_id: requestId,
        },
      );

      if (beginError) {
        throw beginError;
      }

      const operation = Array.isArray(operationRows) ? operationRows[0] : operationRows;

      if (!operation?.operation_id) {
        throw new Error("Force-name-change operation could not be started.");
      }

      if (operation.operation_status === "completed") {
        const { data: updatedCount, error: completionError } = await supabase.rpc(
          "complete_force_name_operation_with_rationale",
          { p_operation_id: operation.operation_id },
        );

        if (completionError) {
          throw completionError;
        }

        return NextResponse.json({ success: true, updatedCount });
      }

      if (operation.operation_status !== "pending") {
        throw new Error("force_name_change_reconciliation_required");
      }

      let authMutationApplied = false;

      try {
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetUserId, {
          app_metadata: nextAppMetadata,
        });

        if (authUpdateError) {
          throw authUpdateError;
        }

        authMutationApplied = true;
        const { data: updatedCount, error: forceNameError } = await supabase.rpc(
          "complete_force_name_operation_with_rationale",
          { p_operation_id: operation.operation_id },
        );

        if (forceNameError) {
          throw forceNameError;
        }

        return NextResponse.json({ success: true, updatedCount });
      } catch (forceNameError) {
        const { data: replayCount, error: replayError } = await supabase.rpc(
          "complete_force_name_operation_with_rationale",
          { p_operation_id: operation.operation_id },
        );

        if (!replayError) {
          return NextResponse.json({ success: true, updatedCount: replayCount });
        }

        if (!authMutationApplied) {
          const { data: safelyAborted, error: abortError } = await supabase.rpc(
            "abort_force_name_operation",
            { p_operation_id: operation.operation_id },
          );

          if (abortError || safelyAborted !== true) {
            throw new Error("force_name_change_reconciliation_required", {
              cause: forceNameError,
            });
          }

          throw forceNameError;
        }

        const latestTargetUser = await getLatestAuthUser(
          admin,
          targetUserId,
          "force-name-change compensation",
        );
        const latestMetadata = latestTargetUser?.app_metadata ?? {};
        const metadataStillMatches =
          latestMetadata.force_name_change === true &&
          latestMetadata[REJECTED_PROFILE_NAME_FINGERPRINT_KEY] ===
            nextAppMetadata[REJECTED_PROFILE_NAME_FINGERPRINT_KEY] &&
          JSON.stringify(
            latestMetadata[REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY] ?? [],
          ) ===
            JSON.stringify(
              nextAppMetadata[REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY] ?? [],
            );

        if (!metadataStillMatches) {
          console.error(
            "Force-name-change Auth metadata changed during compensation; reconciliation required.",
          );
          throw new Error("force_name_change_reconciliation_required");
        }

        const rollbackMetadata = {
          ...latestMetadata,
          force_name_change: targetUser.app_metadata?.force_name_change ?? null,
          [REJECTED_PROFILE_NAME_FINGERPRINT_KEY]:
            targetUser.app_metadata?.[REJECTED_PROFILE_NAME_FINGERPRINT_KEY] ?? null,
          [REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY]:
            targetUser.app_metadata?.[REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY] ?? null,
        };
        const { error: rollbackError } = await admin.auth.admin.updateUserById(
          targetUserId,
          { app_metadata: rollbackMetadata },
        );

        if (rollbackError) {
          console.error(
            "Force-name-change Auth compensation failed; reconciliation required:",
            rollbackError.message,
          );
          throw new Error("force_name_change_reconciliation_required");
        }

        const { data: safelyAborted, error: abortError } = await supabase.rpc(
          "abort_force_name_operation",
          { p_operation_id: operation.operation_id },
        );

        if (abortError || safelyAborted !== true) {
          console.error(
            "Force-name-change operation could not verify compensation; reconciliation required.",
            abortError?.message,
          );
          throw new Error("force_name_change_reconciliation_required", {
            cause: forceNameError,
          });
        }

        throw forceNameError;
      }
    }

    if (action === "save_notes") {
      const permissionError = requireAction(
        MODERATION_ACTIONS.triageReports,
        "Report triage permission required.",
      );

      if (permissionError) {
        return permissionError;
      }

      const reportId = typeof payload?.reportId === "string" ? payload.reportId.trim() : "";
      const moderatorNotesResult = validateModeratorNote(payload?.moderatorNotes);
      const operationId =
        typeof payload?.operationId === "string" ? payload.operationId.trim() : "";

      if (
        !UUID_PATTERN.test(reportId)
        || !UUID_PATTERN.test(operationId)
        || !moderatorNotesResult.ok
      ) {
        return NextResponse.json({ error: "Missing report id." }, { status: 400 });
      }

      const { error } = await supabase.rpc("save_report_moderator_note", {
        p_report_id: reportId,
        p_moderator_note: moderatorNotesResult.value,
        p_request_id: operationId,
      });

      if (error) {
        throw error;
      }

      return NextResponse.json({ success: true });
    }

    if (action === "add_note") {
      const permissionError = requireAction(
        MODERATION_ACTIONS.triageReports,
        "Report triage permission required.",
      );

      if (permissionError) {
        return permissionError;
      }

      const reportId = typeof payload?.reportId === "string" ? payload.reportId.trim() : "";
      const moderatorNoteResult = validateModeratorNoteEntry(payload?.moderatorNote);
      const operationId =
        typeof payload?.operationId === "string" ? payload.operationId.trim() : "";

      if (
        !UUID_PATTERN.test(reportId)
        || !UUID_PATTERN.test(operationId)
        || !moderatorNoteResult.ok
      ) {
        return NextResponse.json({ error: "Missing report note." }, { status: 400 });
      }

      const { data: noteRows, error } = await supabase.rpc(
        "append_report_moderator_note",
        {
          p_report_id: reportId,
          p_moderator_note: moderatorNoteResult.value,
          p_request_id: operationId,
        },
      );

      if (error) {
        throw error;
      }

      const note = Array.isArray(noteRows) ? noteRows[0] : noteRows;
      return NextResponse.json({ success: true, note });
    }

    return NextResponse.json({ error: "Unsupported moderation action." }, { status: 400 });
  } catch (error) {
    console.error("Failed to perform moderation action:", error?.message ?? error);
    return NextResponse.json(
      { error: "Could not complete the moderation action right now." },
      { status: 500 },
    );
  }
}
