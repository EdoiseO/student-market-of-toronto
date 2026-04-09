export const MESSAGE_NOTIFICATION_TYPE = "messages";
export const LEGACY_MESSAGE_NOTIFICATION_TYPE = "message";
export const SOLD_NOTIFICATION_TYPE = "sold";
export const FAVOURITE_NOTIFICATION_TYPE = "favourite";

export const FAVOURITE_SOLD_NOTIFICATION_TYPE = "favourite_sold";
export const FAVOURITE_UNAVAILABLE_NOTIFICATION_TYPE = "favourite_unavailable";
export const FAVOURITE_PRICE_CHANGE_NOTIFICATION_TYPE = "favourite_price_change";
export const LISTING_SOLD_NOTIFICATION_TYPE = "listing_sold";

export const MESSAGE_NOTIFICATION_ROW_TYPES = [
  LEGACY_MESSAGE_NOTIFICATION_TYPE,
  MESSAGE_NOTIFICATION_TYPE,
];

export const FAVOURITE_NOTIFICATION_ROW_TYPES = [
  FAVOURITE_SOLD_NOTIFICATION_TYPE,
  FAVOURITE_UNAVAILABLE_NOTIFICATION_TYPE,
  FAVOURITE_PRICE_CHANGE_NOTIFICATION_TYPE,
];

export const SOLD_NOTIFICATION_ROW_TYPES = [LISTING_SOLD_NOTIFICATION_TYPE];

export const NOTIFICATION_PREFERENCE_TYPES = [
  SOLD_NOTIFICATION_TYPE,
  FAVOURITE_NOTIFICATION_TYPE,
  MESSAGE_NOTIFICATION_TYPE,
];

const NOTIFICATION_ROW_TYPES_BY_PREFERENCE = {
  [SOLD_NOTIFICATION_TYPE]: SOLD_NOTIFICATION_ROW_TYPES,
  [FAVOURITE_NOTIFICATION_TYPE]: FAVOURITE_NOTIFICATION_ROW_TYPES,
  [MESSAGE_NOTIFICATION_TYPE]: MESSAGE_NOTIFICATION_ROW_TYPES,
};

export const NOTIFICATION_SELECT = `
  id,
  user_id,
  type,
  read_at,
  created_at,
  conversation_id,
  message_id,
  listing_id,
  metadata,
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

export const defaultNotificationChannelPreferences = {
  email: true,
  inApp: true,
};

export const defaultMessageNotificationPreferences = defaultNotificationChannelPreferences;

export function normalizeNotificationChannelPreferences(preferencesRow) {
  return {
    email: preferencesRow?.email_enabled ?? defaultNotificationChannelPreferences.email,
    inApp: preferencesRow?.in_app_enabled ?? defaultNotificationChannelPreferences.inApp,
  };
}

export function normalizeMessageNotificationPreferences(preferencesRow) {
  return normalizeNotificationChannelPreferences(preferencesRow);
}

export function isMessageNotificationType(type) {
  return MESSAGE_NOTIFICATION_ROW_TYPES.includes(type);
}

export function getEnabledNotificationRowTypes(notificationPreferences = {}) {
  return Array.from(
    new Set(
      NOTIFICATION_PREFERENCE_TYPES.flatMap((preferenceType) =>
        notificationPreferences[preferenceType]?.inApp
          ? (NOTIFICATION_ROW_TYPES_BY_PREFERENCE[preferenceType] ?? [])
          : [],
      ),
    ),
  );
}

export function buildNotificationPreferencesMap(preferenceRows = []) {
  const preferencesMap = Object.fromEntries(
    NOTIFICATION_PREFERENCE_TYPES.map((notificationType) => [
      notificationType,
      { ...defaultNotificationChannelPreferences },
    ]),
  );

  preferenceRows.forEach((preferencesRow) => {
    if (!preferencesRow?.notification_type || !preferencesMap[preferencesRow.notification_type]) {
      return;
    }

    preferencesMap[preferencesRow.notification_type] =
      normalizeNotificationChannelPreferences(preferencesRow);
  });

  return preferencesMap;
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

function getNotificationMetadata(notification) {
  if (
    notification?.metadata &&
    typeof notification.metadata === "object" &&
    !Array.isArray(notification.metadata)
  ) {
    return notification.metadata;
  }

  return {};
}

function formatNotificationPrice(value, language) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: numericValue % 1 === 0 ? 0 : 2,
  }).format(numericValue);
}

function getListingNotificationHref(metadata) {
  if (typeof metadata.href === "string" && metadata.href.trim().length > 0) {
    return metadata.href;
  }

  if (typeof metadata.listing_slug === "string" && metadata.listing_slug.trim().length > 0) {
    return `/listings/${metadata.listing_slug}`;
  }

  return "/dashboard?tab=favourite";
}

function getListingNotificationDescription(notification, t, language) {
  const metadata = getNotificationMetadata(notification);

  if (notification.type === FAVOURITE_SOLD_NOTIFICATION_TYPE) {
    return t.notificationFavouriteSoldDescription;
  }

  if (notification.type === FAVOURITE_UNAVAILABLE_NOTIFICATION_TYPE) {
    return t.notificationFavouriteUnavailableDescription;
  }

  if (notification.type === LISTING_SOLD_NOTIFICATION_TYPE) {
    return t.notificationListingSoldDescription;
  }

  if (notification.type === FAVOURITE_PRICE_CHANGE_NOTIFICATION_TYPE) {
    const oldPrice = formatNotificationPrice(metadata.old_price, language);
    const newPrice = formatNotificationPrice(metadata.new_price, language);

    if (oldPrice && newPrice) {
      return t.notificationFavouritePriceChangeWithPrices
        .replace("{oldPrice}", oldPrice)
        .replace("{newPrice}", newPrice);
    }

    return t.notificationFavouritePriceChangeDescription;
  }

  return t.notifications;
}

function isListingNotificationType(type) {
  return [...FAVOURITE_NOTIFICATION_ROW_TYPES, ...SOLD_NOTIFICATION_ROW_TYPES].includes(type);
}

function getMessageNotificationBase(notification, currentUserId, t) {
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

function getNotificationBase(notification, currentUserId, t, language = "en") {
  if (isListingNotificationType(notification?.type)) {
    const metadata = getNotificationMetadata(notification);

    return {
      id: notification.id,
      type: notification.type,
      readAt: notification.read_at,
      createdAt: notification.created_at,
      conversationId: null,
      href: getListingNotificationHref(metadata),
      title:
        typeof metadata.listing_title === "string" && metadata.listing_title.trim().length > 0
          ? metadata.listing_title
          : t.notifications,
      description: getListingNotificationDescription(notification, t, language),
    };
  }

  const messageNotificationBase = getMessageNotificationBase(notification, currentUserId, t);

  return {
    ...messageNotificationBase,
    description: messageNotificationBase.messagePreview
      ? t.notificationMessagePreview
          .replace("{name}", messageNotificationBase.senderName)
          .replace("{message}", messageNotificationBase.messagePreview)
      : t.notificationMessageFrom.replace("{name}", messageNotificationBase.senderName),
  };
}

export function normalizeNotificationRow(notification, currentUserId, t, language = "en") {
  const notificationBase = getNotificationBase(notification, currentUserId, t, language);

  return {
    id: notificationBase.id,
    type: notificationBase.type,
    readAt: notificationBase.readAt,
    createdAt: notificationBase.createdAt,
    href: notificationBase.href,
    title: notificationBase.title,
    description: notificationBase.description,
  };
}

export function normalizeGroupedNotificationRow(notification, currentUserId, t, language = "en") {
  const notificationBase = getNotificationBase(notification, currentUserId, t, language);

  return {
    id: notificationBase.id,
    type: notificationBase.type,
    conversationId: notificationBase.conversationId,
    readAt: notificationBase.readAt,
    createdAt: notificationBase.createdAt,
    href: notificationBase.href,
    title: notificationBase.title,
    description: notificationBase.description,
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

function isNotificationPreferencePayload(payload, notificationPreferenceTypes) {
  if (!notificationPreferenceTypes?.length) {
    return true;
  }

  const nextType = payload.new?.notification_type ?? payload.old?.notification_type;
  return !nextType || notificationPreferenceTypes.includes(nextType);
}

export function subscribeToNotificationUpdates({
  supabase,
  userId,
  channelName,
  onChange,
  notificationPreferenceTypes,
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
        if (isNotificationPreferencePayload(payload, notificationPreferenceTypes)) {
          onChange(payload);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
