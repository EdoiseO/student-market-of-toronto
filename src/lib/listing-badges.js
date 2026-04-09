const NEW_LISTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const LISTING_BADGE_KEYS = {
  sold: "sold",
  featured: "featured",
  priceDrop: "price-drop",
  negotiable: "negotiable",
  new: "new",
  listing: "listing",
};

export function isNewListing(createdAt) {
  const createdTime = new Date(createdAt).getTime();

  return !Number.isNaN(createdTime) && Date.now() - createdTime <= NEW_LISTING_WINDOW_MS;
}

export function hasPriceDrop(listing) {
  return (
    listing?.previous_price !== null &&
    listing?.previous_price !== undefined &&
    Number(listing.previous_price) > Number(listing.price ?? 0)
  );
}

export function getListingBadgeKey(listing, { includeFallback = false } = {}) {
  if (listing?.status === "sold") {
    return LISTING_BADGE_KEYS.sold;
  }

  if (listing?.is_featured) {
    return LISTING_BADGE_KEYS.featured;
  }

  if (hasPriceDrop(listing)) {
    return LISTING_BADGE_KEYS.priceDrop;
  }

  if (listing?.is_negotiable) {
    return LISTING_BADGE_KEYS.negotiable;
  }

  if (listing?.created_at && isNewListing(listing.created_at)) {
    return LISTING_BADGE_KEYS.new;
  }

  return includeFallback ? LISTING_BADGE_KEYS.listing : undefined;
}

export function getTranslatedListingBadge(badgeKey, t) {
  switch (badgeKey) {
    case LISTING_BADGE_KEYS.sold:
      return t.sold;
    case LISTING_BADGE_KEYS.featured:
      return t.featured;
    case LISTING_BADGE_KEYS.priceDrop:
      return t.priceDrop;
    case LISTING_BADGE_KEYS.negotiable:
      return t.negotiable;
    case LISTING_BADGE_KEYS.new:
      return t.new;
    case LISTING_BADGE_KEYS.listing:
      return t.listing;
    default:
      return badgeKey;
  }
}
