"use client";

/* eslint-disable @next/next/no-img-element */
import * as React from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardFooter,
  CardTitle,
} from "@/components/ui/card"

const HOVER_IMAGE_CYCLE_MS = 900;

export function CardImage({
  badge,
  title = "Campus essentials bundle",
  price = "$40",
  meta = "St. George Campus",
  imageUrl,
  imageUrls,
  imageAlt = "Marketplace card",
  actionLabel = "View Listing",
  href = "#",
}) {
  const images = React.useMemo(() => {
    const normalizedImages = (imageUrls ?? []).filter(Boolean);

    if (normalizedImages.length > 0) {
      return normalizedImages;
    }

    return imageUrl ? [imageUrl] : [];
  }, [imageUrl, imageUrls]);

  const [activeImageIndex, setActiveImageIndex] = React.useState(0);
  const [isCycling, setIsCycling] = React.useState(false);
  const [shouldPreloadGallery, setShouldPreloadGallery] = React.useState(false);
  const hasMultipleImages = images.length > 1;

  React.useEffect(() => {
    setActiveImageIndex((currentIndex) =>
      currentIndex >= images.length ? 0 : currentIndex
    );
  }, [images.length]);

  function handlePointerEnter() {
    if (!hasMultipleImages) {
      return;
    }

    setShouldPreloadGallery(true);
    setIsCycling(true);
    setActiveImageIndex(0);
  }

  function handlePointerLeave() {
    setIsCycling(false);
    setActiveImageIndex(0);
  }

  React.useEffect(() => {
    if (!hasMultipleImages || !shouldPreloadGallery) {
      return;
    }

    const preloadedImages = images.slice(1).map((currentImageUrl) => {
      const preloadedImage = new window.Image();
      preloadedImage.src = currentImageUrl;
      return preloadedImage;
    });

    return () => {
      preloadedImages.length = 0;
    };
  }, [hasMultipleImages, images, shouldPreloadGallery]);

  React.useEffect(() => {
    if (!hasMultipleImages || !isCycling) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveImageIndex((currentIndex) => (currentIndex + 1) % images.length);
    }, HOVER_IMAGE_CYCLE_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasMultipleImages, images.length, isCycling]);

  return (
    <Link
      href={href}
      className="group block h-full focus-visible:outline-none"
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
      onFocus={handlePointerEnter}
      onBlur={handlePointerLeave}
      aria-label={`${actionLabel}: ${title}`}
    >
      <Card className="flex h-full w-full max-w-none flex-col gap-0 overflow-hidden border-zinc-200 bg-white pt-0 shadow-sm ring-1 ring-zinc-200/80 transition-transform group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-zinc-900/15">
        <div className="relative aspect-[4/3] overflow-hidden bg-zinc-200">
          {images.length > 0 ? (
            <img
              key={`${images[activeImageIndex]}-${activeImageIndex}`}
              src={images[activeImageIndex]}
              alt={imageAlt}
              className="h-full w-full object-cover animate-in fade-in duration-500 ease-out"
            />
          ) : (
            <div
              aria-label={imageAlt}
              className="h-full w-full bg-zinc-200"
            />
          )}
          {badge ? (
            <div className="absolute left-3 top-3 z-10">
              <Badge variant="secondary" className="bg-white/90 text-zinc-900">
                {badge}
              </Badge>
            </div>
          ) : null}
        </div>
        <CardContent className="flex flex-1 flex-col gap-2 p-4">
          <CardTitle className="min-h-[3.5rem] text-lg font-semibold text-zinc-950 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
            {title}
          </CardTitle>
          <p className="text-lg font-bold text-zinc-900">{price}</p>
          <p className="truncate text-sm text-zinc-500">{meta}</p>
        </CardContent>
        <CardFooter className="border-t border-zinc-100 bg-zinc-50/70">
          <div className="w-full rounded-lg bg-zinc-950 px-2.5 py-1.5 text-center text-sm font-medium text-white transition-colors group-hover:bg-zinc-800 group-focus-visible:bg-zinc-800">
            {actionLabel}
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
