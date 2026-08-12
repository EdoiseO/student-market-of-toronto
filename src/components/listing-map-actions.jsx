import { ExternalLink, Map, Navigation } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildMapProviderUrls,
  MAP_PROVIDERS,
} from "@/lib/map-links";
import { translations } from "@/lib/translations";

export function ListingMapActions({ location, preferredProvider, language = "en" }) {
  const t = translations[language] || translations.en;
  const urls = buildMapProviderUrls(location);
  const normalizedPreferredProvider =
    preferredProvider === MAP_PROVIDERS.apple
      ? MAP_PROVIDERS.apple
      : MAP_PROVIDERS.google;
  const providerOrder =
    normalizedPreferredProvider === MAP_PROVIDERS.apple
      ? [MAP_PROVIDERS.apple, MAP_PROVIDERS.google]
      : [MAP_PROVIDERS.google, MAP_PROVIDERS.apple];
  const providerLabels = {
    [MAP_PROVIDERS.apple]: t.openInAppleMaps,
    [MAP_PROVIDERS.google]: t.openInGoogleMaps,
  };

  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-border dark:bg-muted/40 md:mt-4 md:p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-950 dark:text-foreground">
            {location}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-muted-foreground md:text-sm">
            {t.mapAppChoiceDescription}
          </p>
        </div>
        <Badge variant="secondary" className="mt-1 w-fit shrink-0 rounded-full sm:mt-0">
          {t.mapPreferredForDevice}
        </Badge>
      </div>

      <div
        role="group"
        aria-label={t.mapAppChoicesLabel}
        className="mt-3 grid grid-cols-1 gap-2 min-[430px]:grid-cols-2"
      >
        {providerOrder.map((provider, index) => {
          const isPreferred = index === 0;
          const ProviderIcon = provider === MAP_PROVIDERS.apple ? Map : Navigation;

          return (
            <Button
              key={provider}
              asChild
              variant={isPreferred ? "default" : "outline"}
              className="w-full justify-between gap-3 px-4"
            >
              <a href={urls[provider]} aria-label={`${providerLabels[provider]}: ${location}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{providerLabels[provider]}</span>
                </span>
                <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
              </a>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
