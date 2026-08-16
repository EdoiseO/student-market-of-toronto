import assert from "node:assert/strict";
import test from "node:test";

import {
  ANNOUNCEMENT_NOTIFICATION_TYPE,
  getEnabledNotificationRowTypes,
  isMessageNotificationType,
  normalizeNotificationRow,
} from "../src/lib/notifications.js";

test("announcement notices stay visible when ordinary message notifications are disabled", () => {
  const enabledTypes = getEnabledNotificationRowTypes({
    messages: { inApp: false, email: false },
    sold: { inApp: false, email: false },
    favourite: { inApp: false, email: false },
  });

  assert.equal(ANNOUNCEMENT_NOTIFICATION_TYPE, "announcement");
  assert.equal(enabledTypes.includes(ANNOUNCEMENT_NOTIFICATION_TYPE), true);
  assert.equal(isMessageNotificationType(ANNOUNCEMENT_NOTIFICATION_TYPE), true);
});

test("announcement notifications keep their message conversation destination and content", () => {
  const normalized = normalizeNotificationRow(
    {
      id: "notification-1",
      type: ANNOUNCEMENT_NOTIFICATION_TYPE,
      read_at: null,
      created_at: "2026-08-16T12:00:00.000Z",
      conversation_id: "conversation-1",
      metadata: { title: "Campus notice" },
      message: { id: "message-1", body: "The library closes at eight." },
      conversations: {
        id: "conversation-1",
        buyer_id: "recipient-1",
        seller_id: "admin-1",
        listings: null,
        buyer_profile: { id: "recipient-1", first_name: "Student" },
        seller_profile: { id: "admin-1", first_name: "Admin" },
      },
    },
    "recipient-1",
    {
      announcements: "Announcements",
      announcementSenderName: "ADMIN",
      messages: "Messages",
      notificationMessagePreview: "{name}: {message}",
      notificationMessageFrom: "Message from {name}",
      student: "Student",
    },
  );

  assert.equal(normalized.href, "/messages/conversation-1");
  assert.equal(normalized.title, "Campus notice");
  assert.equal(normalized.description, "ADMIN: The library closes at eight.");
});
