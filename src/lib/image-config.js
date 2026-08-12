export const REMOTE_IMAGE_BLUR_DATA_URL =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect width='1' height='1' fill='%23d4d4d8'/%3E%3C/svg%3E";

export function isLocalObjectUrl(imageUrl) {
  return typeof imageUrl === "string" && imageUrl.startsWith("blob:");
}
