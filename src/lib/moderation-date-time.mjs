// Moderation timestamps use the marketplace's local time on both the server
// and the browser, including Toronto's daylight-saving offset for each instant.
export function formatModerationDateTime(value, language) {
  if (!value) return "—";

  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}
