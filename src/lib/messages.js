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

export function getConversationDisplayName(profile, t) {
  return [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || t.student;
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

  return {
    id: conversation.id,
    updatedAt: conversation.updated_at,
    lastMessageAt: conversation.last_message_at,
    lastMessagePreview: conversation.last_message_preview,
    unreadCount,
    hasUnreadMessages: unreadCount > 0,
    listing: {
      id: listing?.id,
      slug: listing?.slug,
      title: listing?.title ?? t.listing,
      price: listing?.price ?? 0,
      location: listing?.location ?? t.torontoMeetup,
      imageUrl: getPrimaryListingImageUrl(listing?.listing_images),
    },
    otherParticipant: {
      id: otherParticipant?.id,
      name: getConversationDisplayName(otherParticipant, t),
      school: otherParticipant?.school ?? t.torontoStudent,
      avatarPresetId: otherParticipant?.avatar_preset_id ?? null,
      avatarUrl: otherParticipant?.avatar_url ?? null,
    },
    currentParticipant: {
      id: currentParticipant?.id,
      name: getConversationDisplayName(currentParticipant, t),
      school: currentParticipant?.school ?? t.torontoStudent,
      avatarPresetId: currentParticipant?.avatar_preset_id ?? null,
      avatarUrl: currentParticipant?.avatar_url ?? null,
    },
  };
}
