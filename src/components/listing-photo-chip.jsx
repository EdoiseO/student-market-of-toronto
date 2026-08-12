"use client";

import * as React from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { REMOTE_IMAGE_BLUR_DATA_URL, isLocalObjectUrl } from "@/lib/image-config";

export function useLocalPhotoPreviews(files) {
  const [previews, setPreviews] = React.useState([]);

  React.useEffect(() => {
    const nextPreviews = files.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${file.size}-${index}`,
      imageUrl: URL.createObjectURL(file),
      alt: file.name || `Selected photo ${index + 1}`,
    }));

    setPreviews(nextPreviews);

    return () => {
      nextPreviews.forEach((preview) => URL.revokeObjectURL(preview.imageUrl));
    };
  }, [files]);

  return previews;
}

export function ListingPhotoChip({ index, imageUrl, alt, onRemove, compact = false }) {
  const { t } = useLanguage();

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-2xl border border-zinc-300 bg-zinc-100 text-zinc-600 shadow-[0_0_0_1px_rgba(24,24,27,0.03)] dark:border-border dark:bg-muted dark:text-muted-foreground dark:shadow-none ${
        compact ? "size-16 sm:size-20" : "size-20"
      }`}
    >
      <button
        type="button"
        onClick={onRemove}
        className="group absolute right-0 top-0 z-10 flex size-11 items-center justify-center text-zinc-700 transition hover:text-white dark:text-foreground"
        aria-label={`${t.delete} ${t.photo.toLowerCase()} ${index + 1}`}
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-white/95 shadow-sm transition-colors group-hover:bg-zinc-950 dark:bg-background/95 dark:group-hover:bg-primary">
          <X className="size-3.5" />
        </span>
      </button>
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={alt ?? `${t.photo} ${index + 1}`}
          fill
          sizes={compact ? "(max-width: 639px) 64px, 80px" : "80px"}
          unoptimized={isLocalObjectUrl(imageUrl)}
          placeholder="blur"
          blurDataURL={REMOTE_IMAGE_BLUR_DATA_URL}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-2xl font-semibold">
          {index + 1}
        </div>
      )}
    </div>
  );
}
