"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { REMOTE_IMAGE_BLUR_DATA_URL } from "@/lib/image-config";
import { cn } from "@/lib/utils";

export function ListingPhotoCarousel({ photos, title }) {
  const [isViewerOpen, setIsViewerOpen] = React.useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = React.useState(0);
  const [desktopCarouselApi, setDesktopCarouselApi] = React.useState();
  const activePhoto = photos[activePhotoIndex];
  const hasMultiplePhotos = photos.length > 1;
  const desktopCarouselOptions = React.useMemo(
    () => ({
      loop: hasMultiplePhotos,
      duration: 20,
      breakpoints: {
        "(prefers-reduced-motion: reduce)": { duration: 0 },
      },
    }),
    [hasMultiplePhotos],
  );

  function openPhoto(index) {
    setActivePhotoIndex(index);
    desktopCarouselApi?.scrollTo(index, true);
    setIsViewerOpen(true);
  }

  function showPreviousPhoto() {
    setActivePhotoIndex((currentIndex) => {
      const previousIndex = currentIndex === 0 ? photos.length - 1 : currentIndex - 1;
      return previousIndex;
    });
  }

  function showNextPhoto() {
    setActivePhotoIndex((currentIndex) => {
      const nextIndex = currentIndex === photos.length - 1 ? 0 : currentIndex + 1;
      return nextIndex;
    });
  }

  function handleViewerOpenChange(open) {
    setIsViewerOpen(open);

    if (!open) {
      desktopCarouselApi?.scrollTo(activePhotoIndex, true);
    }
  }

  React.useEffect(() => {
    if (!desktopCarouselApi) {
      return undefined;
    }

    const updateActivePhoto = () => {
      setActivePhotoIndex(desktopCarouselApi.selectedScrollSnap());
    };

    updateActivePhoto();
    desktopCarouselApi.on("select", updateActivePhoto);
    desktopCarouselApi.on("reInit", updateActivePhoto);

    return () => {
      desktopCarouselApi.off("select", updateActivePhoto);
      desktopCarouselApi.off("reInit", updateActivePhoto);
    };
  }, [desktopCarouselApi]);

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
    <DialogPrimitive.Root open={isViewerOpen} onOpenChange={handleViewerOpenChange}>
      <div
        role="region"
        aria-label={`${title} photos`}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-1 md:gap-4 md:overflow-visible md:pb-0 xl:hidden"
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

      <div className="hidden space-y-3 xl:block">
        <Carousel
          className="w-full"
          setApi={setDesktopCarouselApi}
          opts={desktopCarouselOptions}
        >
          <CarouselContent>
            {photos.map((photo, index) => (
              <CarouselItem key={`${photo.label}-desktop-${index}`}>
                <div className="relative aspect-[16/9] overflow-hidden rounded-[2rem] border border-zinc-200 bg-zinc-100 dark:border-border dark:bg-zinc-950">
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
                        sizes="(min-width: 1280px) min(58vw, 820px), 100vw"
                        priority={index === 0}
                        placeholder="blur"
                        blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
                        className="object-contain"
                      />
                      <span className="absolute right-5 top-5 z-10 flex size-11 items-center justify-center rounded-full bg-black/65 text-white shadow-sm backdrop-blur-sm">
                        <Maximize2 className="size-5" aria-hidden="true" />
                      </span>
                    </button>
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-8xl font-semibold text-zinc-500 dark:text-muted-foreground">
                      {index + 1}
                    </span>
                  )}
                  <div className="pointer-events-none absolute left-5 top-5 z-10">
                    <Badge variant="secondary" className="bg-white/90 text-zinc-950 dark:bg-background/90 dark:text-foreground">
                      {photo.label}
                    </Badge>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>

          {hasMultiplePhotos ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute bottom-0 left-4 top-0 z-20 my-auto rounded-full bg-white/90 text-zinc-900 shadow-sm hover:bg-white dark:bg-background/90 dark:text-foreground dark:hover:bg-background"
                aria-label="Show previous photo"
                onClick={() => desktopCarouselApi?.scrollPrev(true)}
              >
                <ChevronLeft className="size-5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute bottom-0 right-4 top-0 z-20 my-auto rounded-full bg-white/90 text-zinc-900 shadow-sm hover:bg-white dark:bg-background/90 dark:text-foreground dark:hover:bg-background"
                aria-label="Show next photo"
                onClick={() => desktopCarouselApi?.scrollNext(true)}
              >
                <ChevronRight className="size-5" />
              </Button>
            </>
          ) : null}
        </Carousel>

        {hasMultiplePhotos ? (
          <div className="flex items-center justify-center gap-2.5" aria-label={`${title} photo previews`}>
            {photos.map((photo, index) => (
              <button
                key={`${photo.label}-thumbnail-${index}`}
                type="button"
                aria-label={`Show ${title} photo ${index + 1}`}
                aria-current={activePhotoIndex === index ? "true" : undefined}
                onClick={() => desktopCarouselApi?.scrollTo(index, true)}
                className={cn(
                  "relative h-16 w-20 overflow-hidden rounded-xl border bg-zinc-100 outline-none transition focus-visible:ring-2 focus-visible:ring-ring dark:bg-muted",
                  activePhotoIndex === index
                    ? "border-zinc-900 ring-2 ring-zinc-900/10 dark:border-ring dark:ring-ring/20"
                    : "border-zinc-200 hover:border-zinc-400 dark:border-border dark:hover:border-ring",
                )}
              >
                {photo.imageUrl ? (
                  <Image
                    src={photo.imageUrl}
                    alt=""
                    fill
                    sizes="80px"
                    placeholder="blur"
                    blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xl font-semibold text-zinc-500 dark:text-muted-foreground">
                    {index + 1}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : null}
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
                <button
                  type="button"
                  className="absolute left-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors duration-100 hover:bg-black/70 active:bg-black/80 motion-reduce:transition-none sm:left-4"
                  aria-label="Show previous photo"
                  onClick={showPreviousPhoto}
                >
                  <ChevronLeft className="size-7" />
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors duration-100 hover:bg-black/70 active:bg-black/80 motion-reduce:transition-none sm:right-4"
                  aria-label="Show next photo"
                  onClick={showNextPhoto}
                >
                  <ChevronRight className="size-7" />
                </button>
              </>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
