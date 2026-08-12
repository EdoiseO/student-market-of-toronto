"use client";

import { ChevronRight, Map, MapPin, Navigation } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  buildMapProviderUrls,
  MAP_PROVIDERS,
} from "@/lib/map-links";

export function ListingMapActions({ location, preferredProvider, labels }) {
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
    [MAP_PROVIDERS.apple]: labels.openInAppleMaps,
    [MAP_PROVIDERS.google]: labels.openInGoogleMaps,
  };

  return (
    <Sheet>
      <div className="flex flex-wrap items-center gap-2.5 border-t border-zinc-200 bg-white p-3 dark:border-border dark:bg-card min-[360px]:flex-nowrap md:gap-3 md:p-4">
        <span className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 dark:bg-muted dark:text-foreground min-[360px]:flex">
          <MapPin className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-500 dark:text-muted-foreground">
            {labels.campusAreaLabel}
          </p>
          <p className="truncate text-sm font-semibold text-zinc-950 dark:text-foreground">
            {location}
          </p>
        </div>
        <SheetTrigger asChild>
          <Button type="button" className="h-11 w-full shrink-0 rounded-xl px-3 min-[360px]:w-auto min-[390px]:px-3.5">
            <Navigation className="size-4" aria-hidden="true" />
            <span>{labels.getDirections}</span>
          </Button>
        </SheetTrigger>
      </div>

      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto max-w-xl rounded-t-[1.75rem] pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-zinc-200 dark:bg-zinc-700" aria-hidden="true" />
        <SheetHeader className="px-4 pb-2 pt-1 text-left">
          <SheetTitle className="text-xl font-semibold">{labels.getDirections}</SheetTitle>
          <SheetDescription className="text-pretty leading-5">{location}</SheetDescription>
        </SheetHeader>

        <div role="group" aria-label={labels.mapAppChoicesLabel} className="grid gap-2 px-4">
          {providerOrder.map((provider, index) => {
            const isPreferred = index === 0;
            const ProviderIcon = provider === MAP_PROVIDERS.apple ? Map : Navigation;

            return (
              <a
                key={provider}
                href={urls[provider]}
                aria-label={`${providerLabels[provider]}: ${location}${isPreferred ? `, ${labels.recommendedForDevice}` : ""}`}
                className="flex min-h-14 items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-2.5 text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-zinc-100 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted/60"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-muted">
                  <ProviderIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5">
                    {providerLabels[provider]}
                  </span>
                  {isPreferred ? (
                    <span className="mt-0.5 block text-xs text-zinc-500 dark:text-muted-foreground min-[390px]:hidden">
                      {labels.recommendedForDevice}
                    </span>
                  ) : null}
                </span>
                {isPreferred ? (
                  <Badge variant="secondary" className="hidden shrink-0 rounded-full text-xs min-[390px]:inline-flex">
                    {labels.recommendedForDevice}
                  </Badge>
                ) : null}
                <ChevronRight className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
              </a>
            );
          })}
        </div>

        <SheetFooter className="px-4 pt-1">
          <SheetClose asChild>
            <Button type="button" variant="ghost" className="w-full">
              {labels.cancel}
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
