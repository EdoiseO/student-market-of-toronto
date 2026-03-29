const NEW_LISTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const sortOptions = [
  { value: "new-old", label: "Date Listed: New to Old" },
  { value: "old-new", label: "Date Listed: Old to New" },
  { value: "price-low-high", label: "Price: Low to High" },
  { value: "price-high-low", label: "Price: High to Low" },
];

export const conditionOptions = [
  { value: "", label: "All conditions" },
  { value: "New", label: "New" },
  { value: "Like New", label: "Like New" },
  { value: "Used", label: "Used" },
];

export const tagOptions = [
  { value: "", label: "All tags" },
  { value: "new", label: "New" },
  { value: "featured", label: "Featured" },
  { value: "negotiable", label: "Negotiable" },
  { value: "price-drop", label: "Price Drop" },
];

export function isNewListing(createdAt) {
  const createdTime = new Date(createdAt).getTime();
  return !Number.isNaN(createdTime) && Date.now() - createdTime <= NEW_LISTING_WINDOW_MS;
}

export function hasPriceDrop(listing) {
  return (
    listing.previous_price !== null &&
    listing.previous_price !== undefined &&
    Number(listing.previous_price) > Number(listing.price ?? 0)
  );
}

export function getListingBadge(listing) {
  if (listing.is_featured) return "Featured";
  if (isNewListing(listing.created_at)) return "New";
  return undefined;
}

export function formatPrice(price) {
  return `$${Number(price ?? 0).toFixed(2)}`;
}

export function matchesTag(listing, tag) {
  if (!tag) return true;
  if (tag === "new") return isNewListing(listing.created_at);
  if (tag === "featured") return Boolean(listing.is_featured);
  if (tag === "negotiable") return Boolean(listing.is_negotiable);
  if (tag === "price-drop") return hasPriceDrop(listing);
  return true;
}

export function sortListings(listings, sortBy) {
  const items = [...listings];

  switch (sortBy) {
    case "old-new":
      return items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    case "price-low-high":
      return items.sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0));
    case "price-high-low":
      return items.sort((a, b) => Number(b.price ?? 0) - Number(a.price ?? 0));
    case "new-old":
    default:
      return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
}

export function normalizeSearchRows(rows = []) {
  return rows.map((listing) => ({
    ...listing,
    listing_images: (listing.listing_images ?? []).sort(
      (firstImage, secondImage) => firstImage.position - secondImage.position
    ),
  }));
}

export function filterAndSortSearchListings(rows, filters) {
  const {
    query = "",
    minPrice = "",
    maxPrice = "",
    condition = "",
    tag = "",
    sortBy = "new-old",
  } = filters;

  return sortListings(
    rows.filter((listing) => {
      const searchTerm = query.toLowerCase();
      const matchesQuery =
        !searchTerm ||
        listing.title?.toLowerCase().includes(searchTerm) ||
        listing.description?.toLowerCase().includes(searchTerm) ||
        listing.category?.toLowerCase().includes(searchTerm) ||
        listing.location?.toLowerCase().includes(searchTerm);

      const numericPrice = Number(listing.price ?? 0);
      const matchesMin = !minPrice || numericPrice >= Number(minPrice);
      const matchesMax = !maxPrice || numericPrice <= Number(maxPrice);
      const matchesCondition = !condition || listing.condition === condition;

      return (
        matchesQuery &&
        matchesMin &&
        matchesMax &&
        matchesCondition &&
        matchesTag(listing, tag)
      );
    }),
    sortBy
  );
}

export function buildSearchHref(basePath, currentParams, updates = {}) {
  const params = new URLSearchParams(currentParams);

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      params.delete(key);
      return;
    }

    params.set(key, String(value));
  });

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
