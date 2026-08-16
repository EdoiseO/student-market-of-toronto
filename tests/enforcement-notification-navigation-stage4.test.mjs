import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONVERSATION_CLOSED_NOTIFICATION_TYPE,
  CONVERSATION_REOPENED_NOTIFICATION_TYPE,
  ENFORCEMENT_NOTIFICATION_ROW_TYPES,
  MODERATION_WARNING_NOTIFICATION_TYPE,
  getEnabledNotificationRowTypes,
  isEnforcementNotificationType,
  normalizeNotificationRow,
} from "../src/lib/notifications.js";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260816165454_enforcement_notification_lifecycle.sql",
    import.meta.url,
  ),
  "utf8",
);
const notificationsButton = readFileSync(
  new URL("../src/components/notifications-button.jsx", import.meta.url),
  "utf8",
);
const standingBanner = readFileSync(
  new URL("../src/components/moderation-standing-banner.jsx", import.meta.url),
  "utf8",
);
const sidebar = readFileSync(
  new URL("../src/components/app-sidebar.jsx", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../src/app/dashboard/page.jsx", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../src/components/dashboard-settings-content.jsx", import.meta.url),
  "utf8",
);
const proxy = readFileSync(new URL("../src/proxy.js", import.meta.url), "utf8");
const bannedPage = readFileSync(
  new URL("../src/app/banned/page.jsx", import.meta.url),
  "utf8",
);
const siteHeader = readFileSync(
  new URL("../src/components/site-header.jsx", import.meta.url),
  "utf8",
);

const t = {
  notificationModerationWarningTitle: "Account warning",
  notificationModerationWarningDescription: "Review the warning.",
  notificationModerationStrikeTitle: "Strike",
  notificationModerationStrikeDescription: "Review the strike.",
  notificationModerationBanTitle: "Restriction",
  notificationModerationBanDescription: "Review the restriction.",
  notificationModerationReviewTitle: "Review updated",
  notificationModerationReviewDescription: "Review the update.",
  notificationConversationClosedTitle: "Conversation closed",
  notificationConversationClosedDescription: "Read only.",
  notificationConversationReopenedTitle: "Conversation reopened",
  notificationConversationReopenedDescription: "Messaging restored.",
};

test("enforcement notification types are always-on and use safe destinations", () => {
  const enabledTypes = getEnabledNotificationRowTypes({
    messages: { inApp: false, email: false },
    sold: { inApp: false, email: false },
    favourite: { inApp: false, email: false },
  });

  assert.ok(ENFORCEMENT_NOTIFICATION_ROW_TYPES.every((type) => enabledTypes.includes(type)));
  assert.equal(isEnforcementNotificationType(MODERATION_WARNING_NOTIFICATION_TYPE), true);

  const warning = normalizeNotificationRow(
    {
      id: "notice-1",
      type: MODERATION_WARNING_NOTIFICATION_TYPE,
      read_at: null,
      dismissed_at: null,
      created_at: "2026-08-16T15:00:00.000Z",
      metadata: {
        sanction_id: "sanction-1",
        internal_note: "must never be rendered",
      },
    },
    "user-1",
    t,
  );

  assert.deepEqual(
    {
      href: warning.href,
      title: warning.title,
      description: warning.description,
    },
    {
      href: "/dashboard/standing",
      title: "Account warning",
      description: "Review the warning.",
    },
  );
  assert.doesNotMatch(JSON.stringify(warning), /internal_note|must never be rendered/);

  const conversation = normalizeNotificationRow(
    {
      id: "notice-2",
      type: CONVERSATION_CLOSED_NOTIFICATION_TYPE,
      read_at: null,
      dismissed_at: null,
      created_at: "2026-08-16T15:01:00.000Z",
      conversation_id: "conversation-1",
      metadata: { action: "closed" },
    },
    "user-1",
    t,
  );

  assert.equal(conversation.href, "/messages/conversation-1");
  assert.equal(conversation.title, "Conversation closed");
  assert.equal(conversation.description, "Read only.");

  const reopened = normalizeNotificationRow(
    {
      id: "notice-3",
      type: CONVERSATION_REOPENED_NOTIFICATION_TYPE,
      read_at: null,
      dismissed_at: null,
      created_at: "2026-08-16T15:02:00.000Z",
      conversation_id: "conversation-1",
      metadata: {
        action: "reopen",
        user_message: "  The conversation may resume after moderator review.  ",
        internal_note: "must never be rendered",
      },
    },
    "user-1",
    t,
  );

  assert.equal(reopened.href, "/messages/conversation-1");
  assert.equal(reopened.description, "The conversation may resume after moderator review.");
  assert.doesNotMatch(JSON.stringify(reopened), /internal_note|must never be rendered/);
});

test("database contract emits safe durable sanction notices and soft lifecycle state", () => {
  assert.match(migration, /add column if not exists dismissed_at timestamptz/i);
  assert.match(migration, /moderation_warning[\s\S]*moderation_strike[\s\S]*moderation_ban/i);
  assert.match(migration, /conversation_closed[\s\S]*conversation_reopened/i);
  assert.match(migration, /before insert or update or delete on public\.notifications/i);
  assert.match(migration, /enforcement_notifications_are_not_deleted_on_dismiss/i);
  assert.match(migration, /new\.read_at := now\(\)/i);
  assert.match(migration, /new\.dismissed_at := now\(\)/i);
  assert.match(migration, /after insert or update on public\.moderation_sanctions/i);
  assert.match(migration, /jsonb_build_object\([\s\S]*'sanction_id'[\s\S]*'severity'/i);
  assert.doesNotMatch(
    migration.slice(migration.indexOf("create or replace function private.emit_moderation")),
    /internal_note|review_private_reason|issued_by_user_id|reason_code|user_message/i,
  );
  assert.match(migration, /notifications_moderation_event_uidx/i);
  assert.match(migration, /on conflict do nothing/i);
});

test("bell soft-dismisses enforcement notices without changing legacy deletion behavior", () => {
  const enforcementBranch = notificationsButton.slice(
    notificationsButton.indexOf("if (isEnforcementNotificationType(notification.type))"),
    notificationsButton.indexOf('let query = supabase.from("notifications").delete()'),
  );

  assert.match(enforcementBranch, /\.update\(\{[\s\S]*dismissed_at:/i);
  assert.doesNotMatch(enforcementBranch, /\.delete\(\)/i);
  assert.match(notificationsButton, /\.is\("dismissed_at", null\)/i);
  assert.match(notificationsButton, /isEnforcementNotificationType\(notification\.type\)[\s\S]*read_at/i);
  assert.match(notificationsButton, /supabase\.from\("notifications"\)\.delete\(\)/i);
});

test("standing is reachable on desktop and at 320px without exposing private notice fields", () => {
  assert.match(sidebar, /title: t\.accountStanding,[\s\S]*url: "\/dashboard\/standing"/i);
  assert.match(dashboard, /grid-cols-1[\s\S]*min-\[360px\]:grid-cols-3/i);
  assert.match(dashboard, /href="\/dashboard\/standing"/i);
  assert.match(settings, /href="\/dashboard\/standing"/i);
  assert.match(siteHeader, /pathname\.startsWith\("\/dashboard\/standing"\)[\s\S]*t\.accountStanding/i);
  assert.match(settings, /min-w-0[\s\S]*break-words/i);
  assert.match(standingBanner, /select\([\s\S]*sanction_type[\s\S]*severity[\s\S]*acknowledged_at/i);
  assert.doesNotMatch(standingBanner, /internal_note|review_private_reason|actor_user_id|issued_by/i);
  assert.match(standingBanner, /grid min-w-0 gap-3/i);
  assert.match(standingBanner, /w-full min-w-0[\s\S]*sm:w-auto/i);
  assert.match(standingBanner, /href="\/dashboard\/standing"/i);
});

test("an authenticated banned user can reach only the canonical standing exception", () => {
  assert.match(proxy, /const isAccountStandingRoute = path === "\/dashboard\/standing"/i);
  assert.match(
    proxy,
    /isBannedAccountAllowedRoute =\s*isBannedRoute \|\| isAccountStandingRoute \|\| isAccountDeleteRoute/i,
  );
  assert.match(proxy, /path === "\/api\/account\/delete" && request\.method === "POST"/i);
  assert.match(
    proxy,
    /isUserBanned\(userStatusResult\.data\) && !isBannedAccountAllowedRoute/i,
  );
  assert.match(proxy, /pathname\.startsWith\("\/dashboard"\)/i);
  assert.match(bannedPage, /href="\/dashboard\/standing"/i);
  assert.match(bannedPage, /\{t\.accountStanding\}/i);
  assert.match(proxy, /if \(!user && isBannedRoute\)[\s\S]*new URL\("\/login"/i);
});
