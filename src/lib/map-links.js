const DEFAULT_MAP_QUERY = "Toronto, Ontario, Canada";
const MAX_MAP_QUERY_CODE_POINTS = 512;

export const MAP_PROVIDERS = {
  apple: "apple",
  google: "google",
};

function normalizeMapQuery(value) {
  const normalizedValue = String(value ?? "").trim();

  if (!normalizedValue) {
    return DEFAULT_MAP_QUERY;
  }

  return Array.from(normalizedValue).slice(0, MAX_MAP_QUERY_CODE_POINTS).join("");
}

export function getPreferredMapProvider(userAgent) {
  const normalizedUserAgent = String(userAgent ?? "");

  return /(?:iPhone|iPad|iPod|Macintosh|Mac OS X)/i.test(normalizedUserAgent)
    ? MAP_PROVIDERS.apple
    : MAP_PROVIDERS.google;
}

export function buildMapProviderUrls(query) {
  const normalizedQuery = normalizeMapQuery(query);
  const appleMapsUrl = new URL("https://maps.apple.com/");
  const googleMapsUrl = new URL("https://www.google.com/maps/search/");

  appleMapsUrl.searchParams.set("q", normalizedQuery);
  googleMapsUrl.searchParams.set("api", "1");
  googleMapsUrl.searchParams.set("query", normalizedQuery);

  return {
    [MAP_PROVIDERS.apple]: appleMapsUrl.href,
    [MAP_PROVIDERS.google]: googleMapsUrl.href,
  };
}
