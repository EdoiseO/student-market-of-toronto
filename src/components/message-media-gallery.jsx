"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Maximize2, Play, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

function isVideoAttachment(attachment) {
  return attachment.mime_type?.startsWith("video/");
}

function AttachmentPreview({ attachment, compact = false }) {
  if (!attachment.signedUrl) {
    return null;
  }

  if (isVideoAttachment(attachment)) {
    return (
      <>
        <video
          src={attachment.signedUrl}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          aria-hidden="true"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/15">
          <span
            className={cn(
              "flex items-center justify-center rounded-full bg-black/70 text-white shadow-sm",
              compact ? "size-7" : "size-10",
            )}
          >
            <Play className={compact ? "size-3.5 fill-current" : "size-4.5 fill-current"} />
          </span>
        </span>
      </>
    );
  }

  return (
    <Image
      src={attachment.signedUrl}
      alt=""
      fill
      unoptimized
      sizes={compact ? "64px" : "(max-width: 639px) 36vw, 176px"}
      className="object-cover transition duration-200 group-hover/media:scale-[1.02]"
    />
  );
}

export function MessageMediaGallery({ attachments }) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const touchStartXRef = React.useRef(null);
  const activeAttachment = attachments[activeIndex];
  const hasMultipleAttachments = attachments.length > 1;

  function openAttachment(index) {
    if (!attachments[index]?.signedUrl) {
      return;
    }

    setActiveIndex(index);
    setIsOpen(true);
  }

  function showPreviousAttachment() {
    setActiveIndex((currentIndex) =>
      currentIndex === 0 ? attachments.length - 1 : currentIndex - 1,
    );
  }

  function showNextAttachment() {
    setActiveIndex((currentIndex) =>
      currentIndex === attachments.length - 1 ? 0 : currentIndex + 1,
    );
  }

  function handleKeyDown(event) {
    if (!hasMultipleAttachments) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPreviousAttachment();
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      showNextAttachment();
    }
  }

  function handleTouchStart(event) {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event) {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX;
    touchStartXRef.current = null;

    if (!hasMultipleAttachments || startX === null || endX === undefined) {
      return;
    }

    const horizontalDistance = endX - startX;

    if (Math.abs(horizontalDistance) < 48) {
      return;
    }

    if (horizontalDistance > 0) {
      showPreviousAttachment();
    } else {
      showNextAttachment();
    }
  }

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={setIsOpen}>
      <div
        role="group"
        className={cn(
          "grid overflow-hidden bg-zinc-100 dark:bg-zinc-950",
          attachments.length === 1
            ? "w-[min(13rem,60vw)] grid-cols-1 sm:w-56 md:w-64"
            : "w-[min(14rem,64vw)] grid-cols-2 gap-px sm:w-64 md:w-72",
        )}
        aria-label={t.sharedMedia}
      >
        {attachments.map((attachment, index) => {
          const isAvailable = Boolean(attachment.signedUrl);
          const isLastOddAttachment = attachments.length === 3 && index === 2;

          return (
            <button
              key={attachment.id}
              type="button"
              className={cn(
                "group/media relative min-h-28 overflow-hidden bg-zinc-200 text-left outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:bg-zinc-900",
                attachments.length === 1 ? "aspect-[4/3] max-h-52" : "aspect-square",
                isLastOddAttachment ? "col-span-2 aspect-[2/1]" : undefined,
                isAvailable ? "cursor-zoom-in" : "cursor-not-allowed",
              )}
              aria-label={`${t.openAttachment}: ${attachment.file_name}`}
              disabled={!isAvailable}
              onClick={() => openAttachment(index)}
            >
              {isAvailable ? (
                <>
                  <AttachmentPreview attachment={attachment} />
                  <span className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/65 text-white opacity-90 shadow-sm backdrop-blur-sm">
                    <Maximize2 className="size-4" aria-hidden="true" />
                  </span>
                </>
              ) : (
                <span className="flex h-full min-h-28 items-center justify-center px-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  {t.attachmentUnavailable}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/95 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[101] flex h-[100dvh] w-screen flex-col overflow-hidden bg-black text-white outline-none"
          onKeyDown={handleKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">
            {t.sharedMedia}
          </DialogPrimitive.Title>

          <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white/90">
                {activeAttachment?.file_name || t.sharedMedia}
              </p>
              {hasMultipleAttachments ? (
                <p className="mt-0.5 text-xs text-white/60">
                  {activeIndex + 1} / {attachments.length}
                </p>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-full text-white hover:bg-white/15 hover:text-white"
                aria-label={t.closeSharedMedia}
              >
                <X className="size-6" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div
            className="relative min-h-0 flex-1 touch-pan-y"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {activeAttachment?.signedUrl ? (
              isVideoAttachment(activeAttachment) ? (
                <video
                  key={activeAttachment.signedUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-contain p-2 sm:p-5"
                  aria-label={activeAttachment.file_name}
                >
                  <source
                    src={activeAttachment.signedUrl}
                    type={activeAttachment.mime_type}
                  />
                </video>
              ) : (
                <Image
                  key={activeAttachment.signedUrl}
                  src={activeAttachment.signedUrl}
                  alt={activeAttachment.file_name}
                  fill
                  unoptimized
                  sizes="100vw"
                  className="object-contain p-2 sm:p-5"
                />
              )
            ) : null}

            {hasMultipleAttachments ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 text-white shadow-sm hover:bg-white/15 hover:text-white sm:left-4"
                  aria-label={t.previousMedia}
                  onClick={showPreviousAttachment}
                >
                  <ChevronLeft className="size-7" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 text-white shadow-sm hover:bg-white/15 hover:text-white sm:right-4"
                  aria-label={t.nextMedia}
                  onClick={showNextAttachment}
                >
                  <ChevronRight className="size-7" />
                </Button>
              </>
            ) : null}
          </div>

          {hasMultipleAttachments ? (
            <div className="flex shrink-0 justify-center gap-2 overflow-x-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
              {attachments.map((attachment, index) => (
                <button
                  key={`${attachment.id}-viewer-thumbnail`}
                  type="button"
                  aria-label={`${t.openAttachment}: ${attachment.file_name}`}
                  aria-current={activeIndex === index ? "true" : undefined}
                  disabled={!attachment.signedUrl}
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    "group/media relative size-16 shrink-0 overflow-hidden rounded-xl border bg-zinc-900 outline-none transition focus-visible:ring-2 focus-visible:ring-white",
                    activeIndex === index
                      ? "border-white ring-2 ring-white/35"
                      : "border-white/20 opacity-65 hover:opacity-100",
                  )}
                >
                  <AttachmentPreview attachment={attachment} compact />
                </button>
              ))}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
