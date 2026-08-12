"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardFooter,
  CardTitle,
} from "@/components/ui/card"
import { getTranslatedListingBadge } from "@/lib/listing-badges";
import { REMOTE_IMAGE_BLUR_DATA_URL } from "@/lib/image-config";
import { cn } from "@/lib/utils";

const HOVER_IMAGE_CYCLE_MS = 900;

export function CardImage({
  badge,
  title = "Campus essentials bundle",
  price = "$40",
  meta = "St. George Campus",
  imageUrl,
  imageUrls,
  imageAlt = "Marketplace card",
  imageSizes = "(max-width: 767px) calc(100vw - 4rem), (max-width: 1023px) 50vw, (max-width: 1535px) 33vw, 25vw",
  actionLabel,
  href = "#",
  compact = false,
  rail = false,
}) {
  const { t } = useLanguage();
  const images = React.useMemo(() => {
    const normalizedImages = (imageUrls ?? []).filter(Boolean);

    if (normalizedImages.length > 0) {
      return normalizedImages;
    }

    return imageUrl ? [imageUrl] : [];
  }, [imageUrl, imageUrls]);

  const [activeImageIndex, setActiveImageIndex] = React.useState(0);
  const [isCycling, setIsCycling] = React.useState(false);
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

    setIsCycling(true);
    setActiveImageIndex(0);
  }

  function handlePointerLeave() {
    setIsCycling(false);
    setActiveImageIndex(0);
  }

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
      className={cn(
        "group block [-webkit-tap-highlight-color:transparent] [content-visibility:auto] focus-visible:outline-none active:opacity-90",
        rail ? "h-auto" : "h-full",
        compact
          ? rail
            ? "[contain-intrinsic-size:auto_236px]"
            : "[contain-intrinsic-size:auto_276px]"
          : "[contain-intrinsic-size:auto_360px]",
      )}
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
      onFocus={handlePointerEnter}
      onBlur={handlePointerLeave}
      aria-label={`${actionLabel ?? t.viewListing}: ${title}`}
    >
      <Card className={cn(
        "flex w-full max-w-none flex-col gap-0 overflow-hidden border-zinc-200 bg-white pt-0 shadow-sm ring-1 ring-zinc-200/80 transition-transform group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-zinc-900/15 dark:border-border dark:bg-card dark:ring-border dark:group-focus-visible:ring-white/15",
        rail ? "h-auto" : "h-full",
      )}>
        <div
          className={cn(
            "relative w-full shrink-0 aspect-[4/3] overflow-hidden bg-zinc-200 dark:bg-muted",
            compact
              ? rail
                ? "h-auto aspect-[4/3]"
                : "h-[108px] min-[430px]:h-[116px] md:h-[136px] lg:h-[148px]"
              : "h-[156px] min-[430px]:h-[168px] md:h-[200px] lg:h-[220px]",
          )}
        >
          {images.length > 0 ? (
            <Image
              key={`${images[activeImageIndex]}-${activeImageIndex}`}
              src={images[activeImageIndex]}
              alt={imageAlt}
              fill
              sizes={imageSizes}
              placeholder="blur"
              blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
              className="object-cover animate-in fade-in duration-500 ease-out"
            />
          ) : (
            <div
              aria-label={imageAlt}
              className="h-full w-full bg-zinc-200 dark:bg-muted"
            />
          )}
          {badge ? (
            <div className={cn("absolute z-10", compact ? "left-2 top-2" : "left-3 top-3")}>
              <Badge
                variant="secondary"
                className={cn(
                  "bg-white/90 text-zinc-900 dark:bg-background/90 dark:text-foreground",
                  compact && "px-2 py-0 text-xs",
                )}
              >
                {getTranslatedListingBadge(badge, t)}
              </Badge>
            </div>
          ) : null}
        </div>
        <CardContent className={cn("flex flex-1 flex-col", compact ? "gap-1.5 p-3" : "gap-2 p-4")}>
          <CardTitle
            className={cn(
              "font-semibold text-zinc-950 dark:text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden",
              compact ? "min-h-10 text-sm leading-5" : "min-h-[3.5rem] text-lg",
            )}
          >
            {title}
          </CardTitle>
          <p className={cn("font-bold text-foreground", compact ? "text-base" : "text-lg")}>{price}</p>
          <p className={cn("truncate text-zinc-500 dark:text-muted-foreground", compact ? "text-xs" : "text-sm")}>{meta}</p>
        </CardContent>
        <CardFooter
          className={cn(
            "border-t border-zinc-100 bg-zinc-50/70 dark:border-border dark:bg-muted/40",
            compact ? "hidden" : "hidden md:flex",
          )}
        >
          <div className="w-full rounded-lg bg-zinc-950 px-2.5 py-1.5 text-center text-sm font-medium text-white transition-colors group-hover:bg-zinc-800 group-focus-visible:bg-zinc-800 dark:bg-primary dark:text-primary-foreground dark:group-hover:bg-primary/90 dark:group-focus-visible:bg-primary/90">
            {actionLabel ?? t.viewListing}
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
