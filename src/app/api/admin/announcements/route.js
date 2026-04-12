import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUserModerationRole } from "@/lib/moderation";
import {
  LEGACY_MESSAGE_NOTIFICATION_TYPE,
  MESSAGE_NOTIFICATION_TYPE,
} from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

async function listAllUsers(admin) {
  const users = [];
  const perPage = 200;

  for (let page = 1; page <= 20; page += 1) {
    const {
      data: { users: pageUsers },
      error,
    } = await admin.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    users.push(...(pageUsers ?? []));

    if (!pageUsers || pageUsers.length < perPage) {
      break;
    }
  }

  return users;
}

async function getOrCreateAnnouncementConversation(admin, recipientId, senderId, body) {
  const { data: existingConversation, error: existingConversationError } = await admin
    .from("conversations")
    .select("id")
    .is("listing_id", null)
    .eq("buyer_id", recipientId)
    .eq("seller_id", senderId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingConversationError) {
    throw existingConversationError;
  }

  if (existingConversation?.id) {
    return existingConversation;
  }

  const now = new Date().toISOString();

  const { data: conversationData, error: conversationError } = await admin
    .from("conversations")
    .insert({
      listing_id: null,
      buyer_id: recipientId,
      seller_id: senderId,
      created_at: now,
      updated_at: now,
      last_message_at: now,
      last_message_preview: body.slice(0, 100),
    })
    .select("id")
    .single();

  if (conversationError) {
    throw conversationError;
  }

  return conversationData;
}

async function updateAnnouncementConversationPreview(admin, conversationId, body, timestamp) {
  const { error } = await admin
    .from("conversations")
    .update({
      updated_at: timestamp,
      last_message_at: timestamp,
      last_message_preview: body.slice(0, 100),
    })
    .eq("id", conversationId);

  if (error) {
    throw error;
  }
}

function isNotificationTypeUnsupported(error) {
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

function isConversationDeleteStateUnsupported(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("conversation_user_state") ||
    message.includes("deleted_at")
  );
}

async function createAnnouncementNotification(admin, recipientId, conversationId, messageId) {
  const notificationPayload = {
    user_id: recipientId,
    conversation_id: conversationId,
    message_id: messageId,
    metadata: {
      title: "Announcements",
      href: `/messages/${conversationId}`,
    },
  };

  const { error } = await admin.from("notifications").insert({
    ...notificationPayload,
    type: MESSAGE_NOTIFICATION_TYPE,
  });

  if (!error) {
    return;
  }

  if (!isNotificationTypeUnsupported(error)) {
    throw error;
  }

  const { error: legacyError } = await admin.from("notifications").insert({
    ...notificationPayload,
    type: LEGACY_MESSAGE_NOTIFICATION_TYPE,
  });

  if (legacyError) {
    throw legacyError;
  }
}

async function hideAnnouncementConversationForSender(admin, senderId, conversationId, timestamp) {
  const { error } = await admin.from("conversation_user_state").upsert(
    {
      conversation_id: conversationId,
      user_id: senderId,
      hidden_at: null,
      deleted_at: timestamp,
    },
    { onConflict: "conversation_id,user_id" },
  );

  if (error) {
    if (isConversationDeleteStateUnsupported(error)) {
      console.error(
        "Announcement sender cleanup needs the latest conversation state schema:",
        error.message,
      );
      return;
    }

    throw error;
  }
}

export async function POST(request) {
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
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (getUserModerationRole(user) !== "admin") {
    return NextResponse.json({ error: "Only admins can send announcements." }, { status: 403 });
  }

  const { message } = await request.json();

  if (!message || !message.trim()) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const body = message.trim();
  const allUsers = await listAllUsers(admin);
  const recipients = allUsers.filter((u) => u.id !== user.id);

  if (recipients.length === 0) {
    return NextResponse.json({ success: true, sentCount: 0, failureCount: 0, noRecipients: true });
  }

  let sentCount = 0;
  const errors = [];

  for (const recipient of recipients) {
    try {
      const now = new Date().toISOString();

      const conversationData = await getOrCreateAnnouncementConversation(admin, recipient.id, user.id, body);

      const { data: insertedMessage, error: messageError } = await admin
        .from("messages")
        .insert({
        conversation_id: conversationData.id,
        sender_id: user.id,
        body,
        created_at: now,
        })
        .select("id")
        .single();

      if (messageError) {
        errors.push({ userId: recipient.id, error: messageError.message });
        continue;
      }

      await updateAnnouncementConversationPreview(admin, conversationData.id, body, now);

      await createAnnouncementNotification(
        admin,
        recipient.id,
        conversationData.id,
        insertedMessage.id,
      );

      await hideAnnouncementConversationForSender(
        admin,
        user.id,
        conversationData.id,
        now,
      );

      sentCount += 1;
    } catch (err) {
      errors.push({ userId: recipient.id, error: err.message });
    }
  }

  if (errors.length > 0) {
    console.error("Announcement partial failures:", errors.slice(0, 10));
  }

  if (sentCount === 0 && errors.length > 0) {
    return NextResponse.json(
      {
        error: errors[0]?.error ?? "Announcement delivery failed.",
        sentCount,
        failureCount: errors.length,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, sentCount, failureCount: errors.length });
}
