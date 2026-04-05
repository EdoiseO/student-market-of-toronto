export const MESSAGE_NOTIFICATION_TYPE = "messages";

export const NOTIFICATION_SELECT = `
  id,
  type,
  read_at,
  created_at,
  conversation_id,
  message_id,
  conversations!notifications_conversation_id_fkey (
    id,
    buyer_id,
    seller_id,
    listings!conversations_listing_id_fkey (
      title,
      slug
    ),
    buyer_profile:profiles!conversations_buyer_id_fkey (
      id,
      first_name,
      last_name,
      avatar_preset_id,
      avatar_url
    ),
    seller_profile:profiles!conversations_seller_id_fkey (
      id,
      first_name,
      last_name,
      avatar_preset_id,
      avatar_url
    )
  )
`;

export const NOTIFICATION_WITH_MESSAGE_SELECT = `
  ${NOTIFICATION_SELECT},
  message:messages!notifications_message_id_fkey (
    id,
    body
  )
`;

export const defaultMessageNotificationPreferences = {
  email: true,
  inApp: true,
};

export function normalizeMessageNotificationPreferences(preferencesRow) {
  return {
    email: preferencesRow?.email_enabled ?? defaultMessageNotificationPreferences.email,
    inApp: preferencesRow?.in_app_enabled ?? defaultMessageNotificationPreferences.inApp,
  };
}

export function isNotificationPreferencesTableMissing(error) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table 'public.notification_preferences'")
  );
}

function getNotificationDisplayName(profile, t) {
  return [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || t.student;
}

function getNotificationMessagePreview(messageBody) {
  return messageBody?.replace(/\s+/g, " ").trim() ?? "";
}

function getNotificationBase(notification, currentUserId, t) {
  const conversation = Array.isArray(notification.conversations)
    ? notification.conversations[0]
    : notification.conversations;
  const listing = Array.isArray(conversation?.listings)
    ? conversation?.listings[0]
    : conversation?.listings;
  const buyerProfile = Array.isArray(conversation?.buyer_profile)
    ? conversation?.buyer_profile[0]
    : conversation?.buyer_profile;
  const sellerProfile = Array.isArray(conversation?.seller_profile)
    ? conversation?.seller_profile[0]
    : conversation?.seller_profile;
  const message = Array.isArray(notification.message) ? notification.message[0] : notification.message;
  const otherParticipant = conversation?.buyer_id === currentUserId ? sellerProfile : buyerProfile;

  return {
    id: notification.id,
    type: notification.type,
    readAt: notification.read_at,
    createdAt: notification.created_at,
    conversationId: notification.conversation_id,
    href: conversation?.id ? `/messages/${conversation.id}` : "/messages",
    title: listing?.title ?? t.messages,
    senderName: getNotificationDisplayName(otherParticipant, t),
    messagePreview: getNotificationMessagePreview(message?.body),
  };
}

export function normalizeNotificationRow(notification, currentUserId, t) {
  const notificationBase = getNotificationBase(notification, currentUserId, t);

  return {
    id: notificationBase.id,
    type: notificationBase.type,
    readAt: notificationBase.readAt,
    createdAt: notificationBase.createdAt,
    href: notificationBase.href,
    title: notificationBase.title,
    description: t.notificationMessageFrom.replace("{name}", notificationBase.senderName),
  };
}

export function normalizeGroupedNotificationRow(notification, currentUserId, t) {
  const notificationBase = getNotificationBase(notification, currentUserId, t);

  return {
    id: notificationBase.id,
    conversationId: notificationBase.conversationId,
    readAt: notificationBase.readAt,
    createdAt: notificationBase.createdAt,
    href: notificationBase.href,
    title: notificationBase.title,
    description: notificationBase.messagePreview
      ? t.notificationMessagePreview
          .replace("{name}", notificationBase.senderName)
          .replace("{message}", notificationBase.messagePreview)
      : t.notificationMessageFrom.replace("{name}", notificationBase.senderName),
  };
}

export function groupNotificationsByConversation(notifications) {
  const groupedNotifications = new Map();

  notifications.forEach((notification) => {
    const groupKey = notification.conversationId ?? notification.id;
    const existingGroup = groupedNotifications.get(groupKey);

    if (!existingGroup) {
      groupedNotifications.set(groupKey, {
        groupKey,
        conversationId: notification.conversationId,
        latestNotification: notification,
        unreadNotifications: notification.readAt ? [] : [notification],
      });
      return;
    }

    if (!notification.readAt) {
      existingGroup.unreadNotifications.push(notification);
    }
  });

  return Array.from(groupedNotifications.values()).map((group) => {
    const displayNotification = group.unreadNotifications[0] ?? group.latestNotification;

    return {
      ...displayNotification,
      groupKey: group.groupKey,
      unreadCount: group.unreadNotifications.length,
      readAt: group.unreadNotifications.length > 0 ? null : displayNotification.readAt,
    };
  });
}

function isMessageNotificationPreferencePayload(payload) {
  const nextType = payload.new?.notification_type ?? payload.old?.notification_type;
  return !nextType || nextType === MESSAGE_NOTIFICATION_TYPE;
}

export function subscribeToNotificationUpdates({
  supabase,
  userId,
  channelName,
  onChange,
}) {
  if (!supabase || !userId || !onChange) {
    return () => {};
  }

  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      onChange,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notification_preferences",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (isMessageNotificationPreferencePayload(payload)) {
          onChange(payload);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function formatNotificationDate(dateString, language) {
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dateString));
}
