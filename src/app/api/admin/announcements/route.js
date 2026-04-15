import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUserModerationRole } from "@/lib/moderation";
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
      await admin.from("notifications").insert({
        ...payload,
        type: LEGACY_MESSAGE_NOTIFICATION_TYPE,
      });
    }
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

    const moderationUser =
      (await getLatestAuthUser(admin, user.id, "announcement send")) ?? user;

    if (getUserModerationRole(moderationUser) !== "admin") {
      return NextResponse.json({ error: "Admin role required." }, { status: 403 });
    }

    const body = await request.json();
    const trimmedMessage =
      typeof body?.message === "string" ? body.message.trim() : "";

    if (!trimmedMessage) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    if (trimmedMessage.length > 3000) {
      return NextResponse.json({ error: "Message is too long." }, { status: 400 });
    }

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
    const preview =
      trimmedMessage.length > 100
        ? trimmedMessage.slice(0, 100) + "\u2026"
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

    await Promise.allSettled(
      allConversations.map((c) =>
        admin
          .from("conversations")
          .update({ last_message_at: now, last_message_preview: preview, updated_at: now })
          .eq("id", c.id),
      ),
    );

    await Promise.allSettled(
      allConversations.map((c) => {
        const msg = messageByConversationId.get(c.id);
        return insertAnnouncementNotification(admin, c.buyer_id, c.id, msg?.id ?? null);
      }),
    );

    await Promise.allSettled(
      allConversations.map((c) =>
        admin
          .from("conversation_user_state")
          .upsert(
            { conversation_id: c.id, user_id: moderationUser.id, hidden_at: now },
            { onConflict: "conversation_id,user_id" },
          ),
      ),
    );

    return NextResponse.json({ sentCount, totalRecipients: recipientIds.length });
  } catch (error) {
    console.error("Failed to send announcement:", error?.message ?? error);
    return NextResponse.json(
      { error: error?.message ?? "Could not send the announcement right now." },
      { status: 500 },
    );
  }
}
