"use client";

/* eslint-disable @next/next/no-img-element */

import * as React from "react";
import { X } from "lucide-react";

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

export function ListingPhotoChip({ index, imageUrl, alt, onRemove }) {
  return (
    <div className="relative h-22 w-22 overflow-hidden rounded-[1.4rem] border border-zinc-300 bg-zinc-100 text-zinc-600 shadow-[0_0_0_1px_rgba(24,24,27,0.03)]">
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white/95 text-zinc-700 shadow-sm transition hover:bg-zinc-950 hover:text-white"
        aria-label={`Delete photo ${index + 1}`}
      >
        <X className="size-3.5" />
      </button>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={alt ?? `Photo ${index + 1}`}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-2xl font-semibold">
          {index + 1}
        </div>
      )}
    </div>
  );
}
