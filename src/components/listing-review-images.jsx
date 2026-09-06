"use client";

import { MessageMediaGallery } from "@/components/message-media-gallery";
import { useLanguage } from "@/context/LanguageContext";

// Reuse the existing accessible media viewer, including zoom, swipe and keyboard navigation.
export function ListingReviewImages({ images, imageUrl, title }) {
  const { t } = useLanguage();
  const urls = [...new Set((images?.length ? images : [imageUrl]).filter(Boolean))].slice(0, 10);
  if (!urls.length) return null;
  const attachments = urls.map((url, index) => ({
    id: `listing-photo-${index}`,
    file_name: `${title} · ${index + 1} / ${urls.length}`,
    signedUrl: url,
    mime_type: "image/*",
  }));
  return <div className="w-28 max-w-full shrink-0 overflow-hidden rounded-xl border border-border sm:w-36"><MessageMediaGallery attachments={attachments} preview="single" label={t.adminListingPhotos} openLabel={t.adminListingOpenPhoto} /></div>;
}
