"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Dialog as DialogPrimitive } from "radix-ui";
import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { createCroppedProfileImageFile } from "@/lib/profile-image-crop.mjs";
import { cn } from "@/lib/utils";

const Cropper = dynamic(() => import("react-easy-crop"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-zinc-900" />,
});

const INITIAL_CROP = { x: 0, y: 0 };

export function ProfilePictureEditor({
  open,
  sourceUrl,
  originalFileName,
  isSaving,
  onCancel,
  onSave,
}) {
  const { t } = useLanguage();
  const [crop, setCrop] = React.useState(INITIAL_CROP);
  const [zoom, setZoom] = React.useState(1);
  const [cropPixels, setCropPixels] = React.useState(null);
  const [isPreparing, setIsPreparing] = React.useState(false);
  const isBusy = isSaving || isPreparing;

  const handleCropComplete = React.useCallback((_, nextCropPixels) => {
    setCropPixels(nextCropPixels);
  }, []);

  function resetEditor() {
    setCrop(INITIAL_CROP);
    setZoom(1);
  }

  async function saveCrop() {
    if (!cropPixels || isBusy) {
      return;
    }

    setIsPreparing(true);

    try {
      const croppedFile = await createCroppedProfileImageFile({
        sourceUrl,
        cropPixels,
        originalFileName,
      });
      await onSave(croppedFile);
    } catch (error) {
      console.error("Failed to prepare cropped profile image", error);
      toast.error(t.customProfileImageError);
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isBusy) {
          onCancel();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          aria-busy={isBusy}
          onEscapeKeyDown={(event) => {
            if (isBusy) {
              event.preventDefault();
            }
          }}
          className={cn(
            "fixed inset-0 z-[81] flex h-[100dvh] w-screen flex-col overflow-hidden bg-background text-foreground outline-none",
            "sm:left-1/2 sm:top-1/2 sm:h-[min(46rem,calc(100dvh-2rem))] sm:w-[min(44rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[2rem] sm:ring-1 sm:ring-border",
          )}
        >
          <header className="relative shrink-0 border-b border-border px-4 py-3 pr-16 sm:px-6 sm:py-5 sm:pr-20">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight sm:text-xl">
              {t.profilePhotoCropTitle}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">
              {t.profilePhotoCropDescription}
            </DialogPrimitive.Description>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={isBusy}
              onClick={onCancel}
              className="absolute right-3 top-2.5 rounded-full sm:right-5 sm:top-4"
              aria-label={t.cancel}
            >
              <X className="size-5" />
            </Button>
          </header>

          <div className="relative min-h-0 flex-1 bg-zinc-950 sm:m-5 sm:mb-0 sm:overflow-hidden sm:rounded-3xl">
            <Cropper
              image={sourceUrl}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={4}
              zoomSpeed={0.2}
              aspect={1}
              cropShape="round"
              objectFit="cover"
              showGrid={false}
              roundCropAreaPixels
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
              classes={{
                cropAreaClassName: "!border-2 !border-white !shadow-[0_0_0_9999px_rgba(0,0,0,0.66)]",
              }}
              mediaProps={{ alt: t.profilePhotoCropImageAlt }}
            />
          </div>

          <footer className="shrink-0 space-y-3 border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:border-0 sm:px-6 sm:pb-6 sm:pt-5">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isBusy}
                onClick={resetEditor}
                className="rounded-xl px-3"
              >
                <RotateCcw className="size-4" />
                {t.profilePhotoCropReset}
              </Button>
              <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-xs font-medium text-muted-foreground sm:text-sm">
                <span>{t.profilePhotoCropZoom}</span>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="0.01"
                  value={zoom}
                  disabled={isBusy}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="h-11 min-w-0 w-full cursor-pointer accent-zinc-950 dark:accent-zinc-100"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={isBusy}
                onClick={onCancel}
                className="rounded-xl sm:min-w-28"
              >
                {t.cancel}
              </Button>
              <Button
                type="button"
                disabled={isBusy || !cropPixels}
                onClick={saveCrop}
                className="rounded-xl sm:min-w-36"
              >
                {isBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {isBusy ? t.profilePhotoCropSaving : t.profilePhotoCropSave}
              </Button>
            </div>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
