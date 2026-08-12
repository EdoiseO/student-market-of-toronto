"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { REMOTE_IMAGE_BLUR_DATA_URL } from "@/lib/image-config";
import { cn } from "@/lib/utils";

export function ListingPhotoCarousel({ photos, title }) {
  const [isViewerOpen, setIsViewerOpen] = React.useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = React.useState(0);
  const activePhoto = photos[activePhotoIndex];
  const hasMultiplePhotos = photos.length > 1;

  function openPhoto(index) {
    setActivePhotoIndex(index);
    setIsViewerOpen(true);
  }

  function showPreviousPhoto() {
    setActivePhotoIndex((currentIndex) =>
      currentIndex === 0 ? photos.length - 1 : currentIndex - 1,
    );
  }

  function showNextPhoto() {
    setActivePhotoIndex((currentIndex) =>
      currentIndex === photos.length - 1 ? 0 : currentIndex + 1,
    );
  }

  function handleViewerKeyDown(event) {
    if (!hasMultiplePhotos) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPreviousPhoto();
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      showNextPhoto();
    }
  }

  return (
    <DialogPrimitive.Root open={isViewerOpen} onOpenChange={setIsViewerOpen}>
      <div
        aria-label={`${title} photos`}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-1 md:gap-4 md:overflow-visible md:pb-0 xl:grid-cols-2"
      >
        {photos.map((photo, index) => (
          <div
            key={`${photo.label}-${index}`}
            className={cn(
              "relative h-[216px] max-h-[240px] shrink-0 snap-start overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-zinc-950 min-[430px]:h-[232px]",
              photos.length === 1 ? "w-full" : "w-[85vw]",
              "md:h-[280px] md:w-full md:max-h-none",
            )}
          >
            {photo.imageUrl ? (
              <button
                type="button"
                aria-label={`View ${title} photo ${index + 1} full size`}
                className="relative block h-full w-full cursor-zoom-in outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-primary/70"
                onClick={() => openPhoto(index)}
              >
                <Image
                  src={photo.imageUrl}
                  alt={`${title} photo ${index + 1}`}
                  fill
                  sizes={
                    photos.length === 1
                      ? "(max-width: 767px) calc(100vw - 4rem), (max-width: 1279px) 50vw, 30vw"
                      : "(max-width: 767px) 85vw, (max-width: 1279px) 50vw, 30vw"
                  }
                  priority={index === 0}
                  placeholder="blur"
                  blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
                  className="object-contain"
                />
                <span className="absolute right-3 top-3 z-10 flex size-11 items-center justify-center rounded-full bg-black/65 text-white shadow-sm backdrop-blur-sm md:right-5 md:top-5">
                  <Maximize2 className="size-5" aria-hidden="true" />
                </span>
              </button>
            ) : (
              <span className="flex h-full w-full items-center justify-center text-7xl font-semibold text-zinc-500 dark:text-muted-foreground md:text-8xl">
                {index + 1}
              </span>
            )}
            <div className="pointer-events-none absolute left-3 top-3 z-10 md:left-5 md:top-5">
              <Badge variant="secondary" className="bg-white/90 text-zinc-950 dark:bg-background/90 dark:text-foreground">
                {photo.label}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/95 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[101] flex h-[100dvh] w-screen flex-col overflow-hidden bg-black text-white outline-none"
          onKeyDown={handleViewerKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">
            {title} full image
          </DialogPrimitive.Title>

          <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5">
            <p className="truncate text-sm font-medium text-white/90">
              {title}
              {hasMultiplePhotos ? ` · ${activePhotoIndex + 1} of ${photos.length}` : ""}
            </p>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-full text-white hover:bg-white/15 hover:text-white"
                aria-label="Close full image"
              >
                <X className="size-6" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="relative min-h-0 flex-1">
            {activePhoto?.imageUrl ? (
              <Image
                key={activePhoto.imageUrl}
                src={activePhoto.imageUrl}
                alt={`${title} photo ${activePhotoIndex + 1}, full image`}
                fill
                sizes="100vw"
                priority
                placeholder="blur"
                blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
                className="object-contain p-2 sm:p-5"
              />
            ) : null}

            {hasMultiplePhotos ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 text-white shadow-sm hover:bg-white/15 hover:text-white sm:left-4"
                  aria-label="Show previous photo"
                  onClick={showPreviousPhoto}
                >
                  <ChevronLeft className="size-7" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 text-white shadow-sm hover:bg-white/15 hover:text-white sm:right-4"
                  aria-label="Show next photo"
                  onClick={showNextPhoto}
                >
                  <ChevronRight className="size-7" />
                </Button>
              </>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
