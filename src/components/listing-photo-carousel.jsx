"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

export function ListingPhotoCarousel({ photos, title }) {
  const [api, setApi] = React.useState();
  const [activeIndex, setActiveIndex] = React.useState(0);

  React.useEffect(() => {
    if (!api) {
      return;
    }

    const updateActiveSlide = () => {
      setActiveIndex(api.selectedScrollSnap());
    };

    updateActiveSlide();
    api.on("select", updateActiveSlide);
    api.on("reInit", updateActiveSlide);

    return () => {
      api.off("select", updateActiveSlide);
      api.off("reInit", updateActiveSlide);
    };
  }, [api]);

  return (
    <div className="space-y-5">
      <Carousel className="w-full" setApi={setApi}>
        <CarouselContent>
          {photos.map((photo, index) => (
            <CarouselItem key={`${photo.label}-${index}`}>
              <div className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-zinc-100">
                <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-zinc-200">
                  {photo.imageUrl ? (
                    <img
                      src={photo.imageUrl}
                      alt={`${title} photo ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-7xl font-semibold text-zinc-500 md:text-8xl">
                      {index + 1}
                    </span>
                  )}
                  <div className="absolute left-5 top-5">
                    <Badge variant="secondary" className="bg-white/90 text-zinc-950">
                      {photo.label}
                    </Badge>
                  </div>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>

        <CarouselPrevious className="left-4 top-1/2 size-11 -translate-y-1/2 bg-white/90 text-zinc-900 shadow-sm hover:bg-white" />
        <CarouselNext className="right-4 top-1/2 size-11 -translate-y-1/2 bg-white/90 text-zinc-900 shadow-sm hover:bg-white" />
      </Carousel>

      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {photos.map((photo, index) => (
          <button
            key={`${photo.label}-${index}`}
            type="button"
            onClick={() => api?.scrollTo(index)}
            className={cn(
              "h-14 w-18 overflow-hidden rounded-xl border bg-zinc-100 transition sm:h-16 sm:w-20",
              activeIndex === index
                ? "border-zinc-900 ring-2 ring-zinc-900/10"
                : "border-zinc-200 hover:border-zinc-400"
            )}
          >
            {photo.imageUrl ? (
              <img
                src={photo.imageUrl}
                alt={`${title} thumbnail ${index + 1}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-zinc-500 sm:text-xl">
                {index + 1}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
