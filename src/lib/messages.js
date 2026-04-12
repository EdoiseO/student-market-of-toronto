export const MESSAGE_CONVERSATION_SELECT = `
  id,
  listing_id,
  buyer_id,
  seller_id,
  created_at,
  updated_at,
  last_message_at,
  last_message_preview,
  listings!conversations_listing_id_fkey (
    id,
    slug,
    title,
    price,
    location,
    status,
    listing_images (
      image_url,
      position
    )
  ),
  buyer_profile:profiles!conversations_buyer_id_fkey (
    id,
    first_name,
    last_name,
    school,
    avatar_preset_id,
    avatar_url
  ),
  seller_profile:profiles!conversations_seller_id_fkey (
    id,
    first_name,
    last_name,
    school,
    avatar_preset_id,
    avatar_url
  )
`;

export function isConversationUserStateTableMissing(error) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table 'public.conversation_user_state'")
  );
}

export function isConversationUserStateDeletedAtColumnMissing(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return error?.code === "42703" || error?.code === "PGRST204" || message.includes("deleted_at");
}

function getTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function isConversationVisibleForUser(conversation, deletedAt) {
  if (!conversation?.last_message_at && !conversation?.last_message_preview) {
    return false;
  }

  const deletedTimestamp = getTimestamp(deletedAt);

  if (!deletedTimestamp) {
    return true;
  }

  const lastMessageTimestamp = getTimestamp(conversation?.last_message_at);
  return lastMessageTimestamp !== null && lastMessageTimestamp > deletedTimestamp;
}

export function isConversationHiddenForUser(conversation, hiddenAt, deletedAt) {
  if (!hiddenAt || !isConversationVisibleForUser(conversation, deletedAt)) {
    return false;
  }

  const hiddenTimestamp = getTimestamp(hiddenAt);
  const lastMessageTimestamp = getTimestamp(conversation?.last_message_at);

  if (!hiddenTimestamp || lastMessageTimestamp === null) {
    return false;
  }

  return lastMessageTimestamp <= hiddenTimestamp;
}

export function isConversationInboxVisibleForUser(conversation, hiddenAt, deletedAt) {
  return (
    isConversationVisibleForUser(conversation, deletedAt) &&
    !isConversationHiddenForUser(conversation, hiddenAt, deletedAt)
  );
}

export function isConversationMessageVisibleForUser(message, deletedAt) {
  const deletedTimestamp = getTimestamp(deletedAt);

  if (!deletedTimestamp) {
    return true;
  }

  const messageTimestamp = getTimestamp(message?.created_at);
  return messageTimestamp !== null && messageTimestamp > deletedTimestamp;
}

export function filterConversationMessagesForUser(messages, deletedAt) {
  return (messages ?? []).filter((message) =>
    isConversationMessageVisibleForUser(message, deletedAt),
  );
}

export function getConversationDisplayName(profile, t) {
  return [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || t.student;
}

export function isAnnouncementConversationRow(conversation) {
  const listing = Array.isArray(conversation?.listings)
    ? conversation?.listings[0]
    : conversation?.listings;

  return !listing?.id && !listing?.slug;
}

export function isListingMessagingAvailable(status) {
  return status === "active";
}

export function getListingMessagingUnavailableText(status, t) {
  if (status === "sold") {
    return t.listingSoldMessagingUnavailable;
  }

  if (status === "inactive") {
    return t.listingInactiveMessagingUnavailable;
  }

  return t.listingMessagingUnavailable;
}

export function getListingMessagingUnavailableStatusFromError(error) {
  const detail = [error?.details, error?.hint].find(
    (value) => typeof value === "string" && value.includes("listing_status="),
  );

  if (!detail) {
    return null;
  }

  const matchedStatus = detail.match(/listing_status=([a-z_]+)/i)?.[1]?.toLowerCase() ?? null;

  if (matchedStatus === "sold" || matchedStatus === "inactive") {
    return matchedStatus;
  }

  return null;
}

export function isListingMessagingUnavailableError(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return message.includes("listing_messaging_unavailable");
}

function getPrimaryListingImageUrl(listingImages) {
  return (listingImages ?? [])
    .slice()
    .sort((firstImage, secondImage) => firstImage.position - secondImage.position)[0]
    ?.image_url;
}

export function normalizeConversationRow(conversation, currentUserId, t, unreadCount = 0) {
  const listing = Array.isArray(conversation.listings)
    ? conversation.listings[0]
    : conversation.listings;
  const buyerProfile = Array.isArray(conversation.buyer_profile)
    ? conversation.buyer_profile[0]
    : conversation.buyer_profile;
  const sellerProfile = Array.isArray(conversation.seller_profile)
    ? conversation.seller_profile[0]
    : conversation.seller_profile;
  const otherParticipant = conversation.buyer_id === currentUserId ? sellerProfile : buyerProfile;
  const currentParticipant = conversation.buyer_id === currentUserId ? buyerProfile : sellerProfile;
  const isAnnouncement = isAnnouncementConversationRow(conversation);
  const otherParticipantIsAnnouncementSender = isAnnouncement && conversation.buyer_id === currentUserId;
  const currentParticipantIsAnnouncementSender = isAnnouncement && conversation.seller_id === currentUserId;

  function normalizeParticipant(participant, useAnnouncementSenderIdentity = false) {
    if (useAnnouncementSenderIdentity) {
      return {
        id: null,
        name: t.announcementSenderName,
        school: null,
        avatarPresetId: null,
        avatarUrl: null,
      };
    }

    return {
      id: participant?.id,
      name: getConversationDisplayName(participant, t),
      school: participant?.school ?? t.torontoStudent,
      avatarPresetId: participant?.avatar_preset_id ?? null,
      avatarUrl: participant?.avatar_url ?? null,
    };
  }

  return {
    id: conversation.id,
    updatedAt: conversation.updated_at,
    lastMessageAt: conversation.last_message_at,
    lastMessagePreview: conversation.last_message_preview,
    unreadCount,
    hasUnreadMessages: unreadCount > 0,
    isAnnouncement,
    listing: {
      id: listing?.id,
      slug: listing?.slug,
      title: listing?.title ?? (isAnnouncement ? t.announcements : t.deletedListingTitle ?? t.listing),
      price: listing?.price ?? 0,
      location: listing?.location ?? (isAnnouncement ? t.announcementConversationDescription : t.torontoMeetup),
      status: listing?.status ?? null,
      imageUrl: getPrimaryListingImageUrl(listing?.listing_images),
    },
    otherParticipant: normalizeParticipant(
      otherParticipant,
      otherParticipantIsAnnouncementSender,
    ),
    currentParticipant: normalizeParticipant(
      currentParticipant,
      currentParticipantIsAnnouncementSender,
    ),
  };
}
