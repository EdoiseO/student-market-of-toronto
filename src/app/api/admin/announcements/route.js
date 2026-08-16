import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUserModerationRole } from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
  validateAnnouncementMessage,
} from "@/lib/moderation-policy.mjs";
import {
  MESSAGE_NOTIFICATION_TYPE,
  LEGACY_MESSAGE_NOTIFICATION_TYPE,
} from "@/lib/notifications";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

function isMessageNotificationUnsupported(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "23514" ||
    error?.code === "22P02" ||
    (message.includes("notifications") && message.includes("type"))
  );
}

async function listAnnouncementRecipientIds(admin, senderId) {
  const pageSize = 500;
  const recipientIds = [];

  for (let start = 0; ; start += pageSize) {
    const end = start + pageSize - 1;
    const { data: profileRows, error } = await admin
      .from("profiles")
      .select("id")
      .neq("id", senderId)
      .order("id", { ascending: true })
      .range(start, end);

    if (error) {
      throw error;
    }

    const pageRecipientIds = (profileRows ?? []).map((profile) => profile.id).filter(Boolean);

    recipientIds.push(...pageRecipientIds);

    if (pageRecipientIds.length < pageSize) {
      break;
    }
  }

  return recipientIds;
}

async function insertAnnouncementNotification(admin, userId, conversationId, messageId) {
  const payload = {
    user_id: userId,
    type: MESSAGE_NOTIFICATION_TYPE,
    conversation_id: conversationId,
    message_id: messageId ?? null,
  };

  const { error } = await admin.from("notifications").insert(payload);

  if (error) {
    if (isMessageNotificationUnsupported(error)) {
      const { error: legacyError } = await admin.from("notifications").insert({
        ...payload,
        type: LEGACY_MESSAGE_NOTIFICATION_TYPE,
      });

      if (legacyError) {
        throw legacyError;
      }

      return;
    }

    throw error;
  }
}

async function requireQuerySuccess(query) {
  const { error } = await query;

  if (error) {
    throw error;
  }
}

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

    const validatedMessage = validateAnnouncementMessage(body?.message);

    if (!validatedMessage.ok) {
      return NextResponse.json(
        { error: "Message must be between 1 and 2000 characters." },
        { status: 400 },
      );
    }

    const trimmedMessage = validatedMessage.message;

    const recipientIds = await listAnnouncementRecipientIds(admin, moderationUser.id);

    if (recipientIds.length === 0) {
      return NextResponse.json({ sentCount: 0, totalRecipients: 0, noRecipients: true });
    }

    const { data: existingConversations, error: existingConversationsError } = await admin
      .from("conversations")
      .select("id, buyer_id")
      .eq("seller_id", moderationUser.id)
      .is("listing_id", null)
      .in("buyer_id", recipientIds);

    if (existingConversationsError) {
      throw existingConversationsError;
    }

    const existingByBuyerId = new Map(
      (existingConversations ?? []).map((c) => [c.buyer_id, c]),
    );

    const newRecipientIds = recipientIds.filter((id) => !existingByBuyerId.has(id));

    let allConversations = [...(existingConversations ?? [])];

    if (newRecipientIds.length > 0) {
      const { data: newConversations, error: newConversationsError } = await admin
        .from("conversations")
        .insert(
          newRecipientIds.map((buyerId) => ({
            seller_id: moderationUser.id,
            buyer_id: buyerId,
            listing_id: null,
          })),
        )
        .select("id, buyer_id");

      if (newConversationsError) {
        throw newConversationsError;
      }

      allConversations = [...allConversations, ...(newConversations ?? [])];
    }

    if (allConversations.length === 0) {
      return NextResponse.json({ sentCount: 0, totalRecipients: recipientIds.length, noRecipients: true });
    }

    const now = new Date().toISOString();
    const announcementCharacters = Array.from(trimmedMessage);
    const preview =
      announcementCharacters.length > 100
        ? announcementCharacters.slice(0, 100).join("") + "\u2026"
        : trimmedMessage;

    const { data: insertedMessages, error: messagesError } = await admin
      .from("messages")
      .insert(
        allConversations.map((c) => ({
          conversation_id: c.id,
          sender_id: moderationUser.id,
          body: trimmedMessage,
          created_at: now,
        })),
      )
      .select("id, conversation_id");

    if (messagesError) {
      throw messagesError;
    }

    const messageByConversationId = new Map(
      (insertedMessages ?? []).map((m) => [m.conversation_id, m]),
    );

    const sentCount = insertedMessages?.length ?? 0;

    const deliveryResults = await Promise.allSettled(
      allConversations.map(async (c) => {
        const msg = messageByConversationId.get(c.id);

        await Promise.all([
          requireQuerySuccess(
            admin
              .from("conversations")
              .update({ last_message_at: now, last_message_preview: preview, updated_at: now })
              .eq("id", c.id),
          ),
          insertAnnouncementNotification(admin, c.buyer_id, c.id, msg?.id ?? null),
          requireQuerySuccess(
            admin
              .from("conversation_user_state")
              .upsert(
                { conversation_id: c.id, user_id: moderationUser.id, hidden_at: now },
                { onConflict: "conversation_id,user_id" },
              ),
          ),
        ]);
      }),
    );

    const failedDeliveries = deliveryResults.filter((result) => result.status === "rejected");

    if (failedDeliveries.length > 0) {
      console.error(
        "Announcement post-processing failed for recipients:",
        failedDeliveries.map((result) => result.reason?.message ?? "Unknown error"),
      );
    }

    return NextResponse.json({
      sentCount,
      totalRecipients: recipientIds.length,
      failureCount: failedDeliveries.length,
    });
  } catch (error) {
    console.error("Failed to send announcement:", error?.message ?? error);
    return NextResponse.json(
      { error: "Could not send the announcement right now." },
      { status: 500 },
    );
  }
}
