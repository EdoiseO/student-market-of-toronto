export function isOwnedStoragePath(storagePath, userId, resourceId = null) {
  if (
    typeof storagePath !== "string" ||
    typeof userId !== "string" ||
    !userId ||
    (resourceId !== null && (typeof resourceId !== "string" || !resourceId)) ||
    storagePath.includes("\\")
  ) {
    return false;
  }

  try {
    if (decodeURIComponent(storagePath) !== storagePath) {
      return false;
    }
  } catch {
    return false;
  }

  const storagePathSegments = storagePath.split("/");
  const minimumSegmentCount = resourceId === null ? 2 : 3;

  if (
    storagePathSegments.length < minimumSegmentCount ||
    storagePathSegments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    return false;
  }

  return (
    storagePathSegments[0] === userId &&
    (resourceId === null || storagePathSegments[1] === resourceId)
  );
}
