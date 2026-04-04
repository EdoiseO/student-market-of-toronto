"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

export function ListingPhotoCarousel({ photos, title }) {
  const [api, setApi] = React.useState();
  const [activeIndex, setActiveIndex] = React.useState(0);

  const carouselOptions = React.useMemo(
    () => ({
      watchDrag: false,
    }),
    []
  );

  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < photos.length - 1;

  const handlePreviousMouseDown = React.useCallback((event) => {
    event.stopPropagation();
  }, []);

  const handleNextMouseDown = React.useCallback((event) => {
    event.stopPropagation();
  }, []);

  const handlePreviousClick = React.useCallback(
    (event) => {
      event.stopPropagation();
      if (!canGoPrevious) return;
      api?.scrollPrev();
    },
    [api, canGoPrevious]
  );

  const handleNextClick = React.useCallback(
    (event) => {
      event.stopPropagation();
      if (!canGoNext) return;
      api?.scrollNext();
    },
    [api, canGoNext]
  );

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
      <Carousel className="w-full" setApi={setApi} opts={carouselOptions}>
        <CarouselContent>
          {photos.map((photo, index) => (
            <CarouselItem key={`${photo.label}-${index}`}>
              <div className="pointer-events-none overflow-hidden rounded-[2rem] border border-zinc-200 bg-zinc-100">
                <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-zinc-200">
                  {photo.imageUrl ? (
                    <img
                      src={photo.imageUrl}
                      alt={`${title} photo ${index + 1}`}
                      className="h-full w-full object-contain"
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

        {photos.length > 1 ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute left-4 top-0 bottom-0 z-20 my-auto size-11 rounded-full bg-white/90 text-zinc-900 shadow-sm transition-transform duration-150 ease-out hover:bg-white hover:scale-105 active:scale-95 touch-manipulation disabled:pointer-events-none disabled:opacity-0"
              aria-label="Previous slide"
              disabled={!canGoPrevious}
              onPointerDown={handlePreviousMouseDown}
              onMouseDown={handlePreviousMouseDown}
              onTouchStart={handlePreviousMouseDown}
              onClick={handlePreviousClick}
            >
              <ChevronLeft className="size-5" />
              <span className="sr-only">Previous slide</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-4 top-0 bottom-0 z-20 my-auto size-11 rounded-full bg-white/90 text-zinc-900 shadow-sm transition-transform duration-150 ease-out hover:bg-white hover:scale-105 active:scale-95 touch-manipulation disabled:pointer-events-none disabled:opacity-0"
              aria-label="Next slide"
              disabled={!canGoNext}
              onPointerDown={handleNextMouseDown}
              onMouseDown={handleNextMouseDown}
              onTouchStart={handleNextMouseDown}
              onClick={handleNextClick}
            >
              <ChevronRight className="size-5" />
              <span className="sr-only">Next slide</span>
            </Button>
          </>
        ) : null}
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
