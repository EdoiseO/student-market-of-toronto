import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isUuid, validateAdminConversationCommand } from "@/lib/admin-conversations.mjs";
import { getUserModerationRole } from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

function moderationErrorResponse(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (error?.code === "P0002" || message.includes("conversation_not_found")) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (
    error?.code === "40001" ||
    message.includes("version conflict") ||
    message.includes("source_report_changed") ||
    message.includes("effectively open") ||
    message.includes("only a closed conversation")
  ) {
    return NextResponse.json(
      { error: "The conversation or linked report changed. Refresh and try again." },
      { status: 409 },
    );
  }

  if (error?.code === "42501") {
    return NextResponse.json(
      { error: "You do not have permission to perform this moderation action." },
      { status: 403 },
    );
  }

  if (error?.code === "22023" || error?.code === "23503") {
    return NextResponse.json(
      { error: "The moderation request is no longer valid. Refresh and try again." },
      { status: 400 },
    );
  }

  return null;
}

export async function POST(request, { params }) {
  try {
    const { conversationId } = await params;

    if (!isUuid(conversationId)) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const admin = createAdminClient();

    if (!admin) {
      return NextResponse.json(
        { error: "Conversation moderation is not configured in this environment." },
        { status: 503 },
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const accessUser = await getLatestAuthUser(
      admin,
      user.id,
      "conversation moderation action",
    );

    if (!accessUser) {
      return NextResponse.json(
        { error: "Could not verify your current moderation access." },
        { status: 503 },
      );
    }

    const role = getUserModerationRole(accessUser);
    let payload;

    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "The moderation request is invalid." }, { status: 400 });
    }

    const validation = validateAdminConversationCommand(payload, role);

    if (!validation.ok) {
      return NextResponse.json(
        { error: "Complete every required moderation field before continuing." },
        { status: 400 },
      );
    }

    const command = validation.value;
    const requiredAction =
      command.action === "reopen"
        ? MODERATION_ACTIONS.reopenChat
        : MODERATION_ACTIONS.closeChatTemporarily;

    if (!canPerformModerationAction(role, requiredAction)) {
      return NextResponse.json(
        { error: "You do not have permission to perform this moderation action." },
        { status: 403 },
      );
    }

    if (command.duration === "permanent" && role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can close a conversation permanently." },
        { status: 403 },
      );
    }

    if (
      command.resolveSourceReport &&
      !canPerformModerationAction(role, MODERATION_ACTIONS.decideReports)
    ) {
      return NextResponse.json(
        { error: "You do not have permission to resolve linked reports." },
        { status: 403 },
      );
    }

    const { data, error } = await admin.rpc("admin_moderate_conversation", {
      p_actor_id: accessUser.id,
      p_conversation_id: conversationId,
      p_expected_version: command.expectedVersion,
      p_action: command.action,
      p_reason_code: command.reasonCode,
      p_user_message: command.userMessage,
      p_duration: command.duration,
      p_internal_note: command.internalNote,
      p_source_report_id: command.sourceReportId,
      p_resolve_source_report: command.resolveSourceReport,
      p_operation_id: command.operationId,
    });

    if (error) {
      const response = moderationErrorResponse(error);

      if (response) {
        return response;
      }

      throw error;
    }

    return NextResponse.json({ success: true, state: data });
  } catch (error) {
    console.error("Failed to moderate conversation:", error?.message ?? error);
    return NextResponse.json(
      { error: "Could not update this conversation right now." },
      { status: 500 },
    );
  }
}
