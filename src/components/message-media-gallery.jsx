"use client";

import * as React from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minus,
  Play,
  Plus,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

function isVideoAttachment(attachment) {
  return attachment.mime_type?.startsWith("video/");
}

const MIN_IMAGE_ZOOM = 1;
const MAX_IMAGE_ZOOM = 4;
const IMAGE_ZOOM_STEP = 0.5;
const INITIAL_IMAGE_TRANSFORM = Object.freeze({ scale: 1, x: 0, y: 0 });

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getPointerDistance(firstPointer, secondPointer) {
  return Math.hypot(
    secondPointer.x - firstPointer.x,
    secondPointer.y - firstPointer.y,
  );
}

function getPointerCenter(firstPointer, secondPointer) {
  return {
    x: (firstPointer.x + secondPointer.x) / 2,
    y: (firstPointer.y + secondPointer.y) / 2,
  };
}

function clampImageTransform(viewport, transform) {
  const scale = clamp(transform.scale, MIN_IMAGE_ZOOM, MAX_IMAGE_ZOOM);

  if (!viewport || scale === MIN_IMAGE_ZOOM) {
    return { ...INITIAL_IMAGE_TRANSFORM };
  }

  const viewportRect = viewport.getBoundingClientRect();
  const image = viewport.querySelector("img");
  const naturalWidth = image?.naturalWidth || viewportRect.width;
  const naturalHeight = image?.naturalHeight || viewportRect.height;
  const imageAspectRatio = naturalWidth / naturalHeight;
  const viewportAspectRatio = viewportRect.width / viewportRect.height;
  const fittedWidth =
    imageAspectRatio > viewportAspectRatio
      ? viewportRect.width
      : viewportRect.height * imageAspectRatio;
  const fittedHeight =
    imageAspectRatio > viewportAspectRatio
      ? viewportRect.width / imageAspectRatio
      : viewportRect.height;
  const maximumX = Math.max(0, (fittedWidth * scale - viewportRect.width) / 2);
  const maximumY = Math.max(0, (fittedHeight * scale - viewportRect.height) / 2);

  return {
    scale,
    x: clamp(transform.x, -maximumX, maximumX),
    y: clamp(transform.y, -maximumY, maximumY),
  };
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
      sizes={compact ? "64px" : "(max-width: 639px) 36vw, 176px"}
      className="object-cover transition duration-200 group-hover/media:scale-[1.02]"
    />
  );
}

function ZoomableMessageImage({
  attachment,
  canSwipe,
  labels,
  onSwipePrevious,
  onSwipeNext,
  onZoomChange,
}) {
  const viewportRef = React.useRef(null);
  const pointersRef = React.useRef(new Map());
  const gestureRef = React.useRef(null);
  const transformRef = React.useRef(INITIAL_IMAGE_TRANSFORM);
  const [transform, setTransform] = React.useState(INITIAL_IMAGE_TRANSFORM);

  function commitTransform(nextTransform) {
    const clampedTransform = clampImageTransform(viewportRef.current, nextTransform);
    transformRef.current = clampedTransform;
    setTransform(clampedTransform);
    onZoomChange(clampedTransform.scale);
  }

  function resetZoom() {
    commitTransform(INITIAL_IMAGE_TRANSFORM);
  }

  function zoomBy(amount) {
    const currentTransform = transformRef.current;
    commitTransform({
      ...currentTransform,
      scale: currentTransform.scale + amount,
    });
  }

  function handleWheel(event) {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP);
  }

  function startPinchGesture() {
    const [firstPointer, secondPointer] = [...pointersRef.current.values()];

    gestureRef.current = {
      type: "pinch",
      startCenter: getPointerCenter(firstPointer, secondPointer),
      startDistance: getPointerDistance(firstPointer, secondPointer),
      startTransform: transformRef.current,
    };
  }

  function handlePointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pointersRef.current.size === 2) {
      startPinchGesture();
      return;
    }

    gestureRef.current = {
      type: transformRef.current.scale > MIN_IMAGE_ZOOM ? "pan" : "swipe",
      startPointer: { x: event.clientX, y: event.clientY },
      startTransform: transformRef.current,
    };
  }

  function handlePointerMove(event) {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }

    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pointersRef.current.size === 2) {
      if (gestureRef.current?.type !== "pinch") {
        startPinchGesture();
      }

      const [firstPointer, secondPointer] = [...pointersRef.current.values()];
      const gesture = gestureRef.current;
      const currentDistance = getPointerDistance(firstPointer, secondPointer);
      const currentCenter = getPointerCenter(firstPointer, secondPointer);
      const nextScale =
        gesture.startTransform.scale * (currentDistance / gesture.startDistance);

      commitTransform({
        scale: nextScale,
        x: gesture.startTransform.x + currentCenter.x - gesture.startCenter.x,
        y: gesture.startTransform.y + currentCenter.y - gesture.startCenter.y,
      });
      return;
    }

    const gesture = gestureRef.current;

    if (gesture?.type !== "pan") {
      return;
    }

    commitTransform({
      ...gesture.startTransform,
      x: gesture.startTransform.x + event.clientX - gesture.startPointer.x,
      y: gesture.startTransform.y + event.clientY - gesture.startPointer.y,
    });
  }

  function finishPointerGesture(event, allowSwipe) {
    const gesture = gestureRef.current;
    const endingPointer = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);

    if (
      allowSwipe &&
      canSwipe &&
      gesture?.type === "swipe" &&
      endingPointer &&
      transformRef.current.scale === MIN_IMAGE_ZOOM
    ) {
      const horizontalDistance = endingPointer.x - gesture.startPointer.x;
      const verticalDistance = endingPointer.y - gesture.startPointer.y;

      if (Math.abs(horizontalDistance) >= 48 && Math.abs(horizontalDistance) > Math.abs(verticalDistance)) {
        if (horizontalDistance > 0) {
          onSwipePrevious();
        } else {
          onSwipeNext();
        }
      }
    }

    if (pointersRef.current.size === 1 && transformRef.current.scale > MIN_IMAGE_ZOOM) {
      const remainingPointer = [...pointersRef.current.values()][0];
      gestureRef.current = {
        type: "pan",
        startPointer: remainingPointer,
        startTransform: transformRef.current,
      };
    } else {
      gestureRef.current = null;
    }
  }

  return (
    <>
      <div className="absolute inset-2 sm:inset-5">
        <div
          ref={viewportRef}
          className={cn(
            "absolute inset-0 touch-none overflow-hidden",
            transform.scale > MIN_IMAGE_ZOOM
              ? "cursor-grab active:cursor-grabbing"
              : "cursor-zoom-in",
          )}
          onDoubleClick={() => {
            if (transformRef.current.scale > MIN_IMAGE_ZOOM) {
              resetZoom();
            } else {
              zoomBy(1);
            }
          }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishPointerGesture(event, true)}
          onPointerCancel={(event) => finishPointerGesture(event, false)}
        >
          <div
            className="absolute inset-0 will-change-transform"
            style={{
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            }}
          >
            <Image
              src={attachment.signedUrl}
              alt={attachment.file_name}
              fill
              unoptimized
              draggable={false}
              sizes="100vw"
              className="pointer-events-none select-none object-contain"
            />
          </div>
        </div>
      </div>

      <div
        className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center rounded-full border border-white/10 bg-black/65 p-0.5 shadow-lg backdrop-blur-sm sm:top-4"
        role="group"
        aria-label={labels.zoomControls}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full text-white hover:bg-white/15 hover:text-white"
          aria-label={labels.zoomOut}
          disabled={transform.scale <= MIN_IMAGE_ZOOM}
          onClick={() => zoomBy(-IMAGE_ZOOM_STEP)}
        >
          <Minus className="size-4" />
        </Button>
        <button
          type="button"
          className="min-h-11 min-w-14 rounded-full px-2 text-xs font-semibold tabular-nums text-white outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
          aria-label={labels.resetZoom}
          disabled={transform.scale <= MIN_IMAGE_ZOOM}
          onClick={resetZoom}
        >
          {Math.round(transform.scale * 100)}%
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full text-white hover:bg-white/15 hover:text-white"
          aria-label={labels.zoomIn}
          disabled={transform.scale >= MAX_IMAGE_ZOOM}
          onClick={() => zoomBy(IMAGE_ZOOM_STEP)}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </>
  );
}

export function MessageMediaGallery({ attachments }) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [activeZoomScale, setActiveZoomScale] = React.useState(MIN_IMAGE_ZOOM);
  const activeAttachment = attachments[activeIndex];
  const hasMultipleAttachments = attachments.length > 1;

  function openAttachment(index) {
    if (!attachments[index]?.signedUrl) {
      return;
    }

    setActiveIndex(index);
    setActiveZoomScale(MIN_IMAGE_ZOOM);
    setIsOpen(true);
  }

  function selectAttachment(index) {
    setActiveIndex(index);
    setActiveZoomScale(MIN_IMAGE_ZOOM);
  }

  function showPreviousAttachment() {
    selectAttachment(activeIndex === 0 ? attachments.length - 1 : activeIndex - 1);
  }

  function showNextAttachment() {
    selectAttachment(activeIndex === attachments.length - 1 ? 0 : activeIndex + 1);
  }

  function handleKeyDown(event) {
    if (!hasMultipleAttachments || activeZoomScale > MIN_IMAGE_ZOOM) {
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

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);

        if (!nextOpen) {
          setActiveZoomScale(MIN_IMAGE_ZOOM);
        }
      }}
    >
      <div
        role="group"
        className={cn(
          "grid w-full overflow-hidden bg-zinc-100 dark:bg-zinc-950",
          attachments.length === 1
            ? "grid-cols-1"
            : "grid-cols-2 gap-px",
        )}
        aria-label={t.sharedMedia}
      >
        {attachments.map((attachment, index) => {
          const isAvailable = Boolean(attachment.signedUrl);
          const isVideo = isVideoAttachment(attachment);
          const isLastOddAttachment = attachments.length === 3 && index === 2;
          const attachmentClassName = cn(
            "group/media relative min-h-28 overflow-hidden bg-zinc-200 text-left outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:bg-zinc-900",
            attachments.length === 1 ? "aspect-[4/3] max-h-52" : "aspect-square",
            isLastOddAttachment ? "col-span-2 aspect-[2/1]" : undefined,
          );

          if (!isAvailable) {
            return (
              <div
                key={attachment.id}
                className={attachmentClassName}
              >
                <span className="flex h-full min-h-28 items-center justify-center px-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  {t.attachmentUnavailable}
                </span>
              </div>
            );
          }

          if (isVideo) {
            return (
              <div key={attachment.id} className={attachmentClassName}>
                <video
                  src={attachment.signedUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="h-full w-full bg-black object-cover"
                  aria-label={attachment.file_name}
                />
              </div>
            );
          }

          return (
            <button
              key={attachment.id}
              type="button"
              className={cn(
                attachmentClassName,
                "cursor-zoom-in",
              )}
              aria-label={`${t.openAttachment}: ${attachment.file_name}`}
              onClick={() => openAttachment(index)}
            >
              <AttachmentPreview attachment={attachment} />
              <span className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/65 text-white opacity-90 shadow-sm backdrop-blur-sm">
                <Maximize2 className="size-4" aria-hidden="true" />
              </span>
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

          <div className="relative min-h-0 flex-1 overflow-hidden">
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
                <ZoomableMessageImage
                  key={activeAttachment.id}
                  attachment={activeAttachment}
                  canSwipe={hasMultipleAttachments}
                  labels={{
                    zoomControls: t.imageZoomControls,
                    zoomIn: t.zoomImageIn,
                    zoomOut: t.zoomImageOut,
                    resetZoom: t.resetImageZoom,
                  }}
                  onSwipePrevious={showPreviousAttachment}
                  onSwipeNext={showNextAttachment}
                  onZoomChange={setActiveZoomScale}
                />
              )
            ) : null}

            {hasMultipleAttachments && activeZoomScale === MIN_IMAGE_ZOOM ? (
              <>
                <button
                  type="button"
                  className="absolute left-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors duration-100 hover:bg-black/70 active:bg-black/80 motion-reduce:transition-none sm:left-4"
                  aria-label={t.previousMedia}
                  onClick={showPreviousAttachment}
                >
                  <ChevronLeft className="size-7" />
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors duration-100 hover:bg-black/70 active:bg-black/80 motion-reduce:transition-none sm:right-4"
                  aria-label={t.nextMedia}
                  onClick={showNextAttachment}
                >
                  <ChevronRight className="size-7" />
                </button>
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
                  onClick={() => selectAttachment(index)}
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
