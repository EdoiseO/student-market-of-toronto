export const MAX_CATALOG_PAGE = 100_000;
export const MAX_SEARCH_QUERY_LENGTH = 80;

export function normalizeSearchQuery(value) {
  return String(value ?? "").trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
}

export function parseCatalogPage(value) {
  const parsedPage = Number.parseInt(value ?? "1", 10);

  if (!Number.isSafeInteger(parsedPage) || parsedPage < 1) {
    return 1;
  }

  return Math.min(parsedPage, MAX_CATALOG_PAGE);
}

export function getNearbyPageNumbers(currentPage, totalPages, radius = 1) {
  const safeTotalPages = Math.max(1, Math.min(totalPages, MAX_CATALOG_PAGE));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, safeTotalPages));
  const safeRadius = Math.max(0, Math.min(radius, 5));
  const firstPage = Math.max(1, safeCurrentPage - safeRadius);
  const lastPage = Math.min(safeTotalPages, safeCurrentPage + safeRadius);

  return Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );
}
