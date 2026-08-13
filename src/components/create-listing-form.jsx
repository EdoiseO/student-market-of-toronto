"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ImagePlus, Info, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ListingPhotoChip, useLocalPhotoPreviews } from "@/components/listing-photo-chip";
import { Textarea } from "@/components/ui/textarea";
import {
  getValidListingImageFiles,
  LISTING_IMAGE_MAX_COUNT,
  useFileDropzone,
} from "@/hooks/use-file-dropzone";
import { TORONTO_CAMPUS_OPTIONS } from "@/lib/campuses";
import { CATEGORY_OPTIONS, getTranslatedCategoryValue } from "@/lib/categories";
import { useLanguage } from "@/context/LanguageContext";
import {
  LISTING_APPROVAL_STATUS_VALUES,
  isListingApprovalSetupMissing,
} from "@/lib/listing-approval";
import { getTranslatedConditionLabel } from "@/lib/search-listings";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";

const conditionOptions = ["New", "Like New", "Used"];

function slugifyTitle(value) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "listing";
}

function sanitizeFileName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isUniqueSlugError(error) {
  if (!error) {
    return false;
  }

  return (
    error.code === "23505" &&
    (error.message?.includes("slug") || error.details?.includes("slug"))
  );
}

function ListingCombobox({
  label,
  placeholder,
  value,
  onValueChange,
  options,
  description,
  emptyLabel,
}) {
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Combobox value={value} onValueChange={onValueChange}>
        <ComboboxInput placeholder={placeholder} />
        <ComboboxContent>
          <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
          <ComboboxList>
            {normalizedOptions.map((option) => (
              <ComboboxItem key={option.value} value={option.value}>
                {option.label}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

export function CreateListingForm() {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [campus, setCampus] = React.useState("");
  const [condition, setCondition] = React.useState("");
  const [isNegotiable, setIsNegotiable] = React.useState(false);
  const [photos, setPhotos] = React.useState([]);
  const [showAllPhotoPreviews, setShowAllPhotoPreviews] = React.useState(false);
  const [photoError, setPhotoError] = React.useState("");
  const [error, setError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isSubmitWarningOpen, setIsSubmitWarningOpen] = React.useState(false);
  const [hasConfirmedRestrictions, setHasConfirmedRestrictions] = React.useState(false);

  const fileInputRef = React.useRef(null);
  const photoPreviews = useLocalPhotoPreviews(photos);

  const appendPhotos = React.useCallback((selectedFiles) => {
    if (selectedFiles.length === 0) {
      return;
    }

    const validFiles = getValidListingImageFiles(selectedFiles);
    const availableSlots = Math.max(0, LISTING_IMAGE_MAX_COUNT - photos.length);
    const acceptedFiles = validFiles.slice(0, availableSlots);
    const hasRejectedFiles = validFiles.length !== selectedFiles.length;
    const exceedsCount = validFiles.length > availableSlots;

    setPhotoError(
      hasRejectedFiles || exceedsCount
        ? language === "fr"
          ? "Utilisez jusqu’à 10 images JPEG, PNG ou WebP de 5 Mo maximum chacune."
          : "Use up to 10 JPEG, PNG, or WebP images, no larger than 5 MB each."
        : "",
    );

    if (acceptedFiles.length > 0) {
      setPhotos((currentPhotos) => [...currentPhotos, ...acceptedFiles]);
    }
  }, [language, photos.length]);

  const { isDragActive, dropzoneProps } = useFileDropzone(appendPhotos);

  function handleSubmitWarningOpenChange(open) {
    setIsSubmitWarningOpen(open);

    if (!open) {
      setHasConfirmedRestrictions(false);
    }
  }

  function resetForm() {
    setTitle("");
    setCategory("");
    setPrice("");
    setDescription("");
    setCampus("");
    setCondition("");
    setIsNegotiable(false);
    setPhotos([]);
    setPhotoError("");
    setShowAllPhotoPreviews(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function uploadListingPhotos(userId, listingId, files) {
    const uploadedImages = [];

    for (const [index, file] of files.entries()) {
      const safeName = sanitizeFileName(file.name) || `image-${index + 1}`;
      const storagePath = `${userId}/${listingId}/${Date.now()}-${index + 1}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("listing-images")
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage
        .from("listing-images")
        .getPublicUrl(storagePath);

      uploadedImages.push({
        storagePath,
        imageUrl: publicUrlData.publicUrl,
      });
    }

    return uploadedImages;
  }

  async function createListingRecord(userId, status, numericPrice) {
    const baseSlug = slugifyTitle(title.trim());

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;

      const { data, error: insertError } = await supabase
        .from("listings")
        .insert({
          seller_id: userId,
          slug,
          title: title.trim(),
          description: description.trim(),
          price: numericPrice,
          category,
          condition,
          location: campus,
          status,
          is_negotiable: isNegotiable,
        })
        .select("id, slug")
        .single();

      if (!insertError) {
        return data;
      }

      if (!isUniqueSlugError(insertError)) {
        throw insertError;
      }
    }

    throw new Error("Could not generate a unique slug for this listing.");
  }

  async function handleSubmit(status) {
    setError("");

    const numericPrice = Number.parseFloat(
      price.replaceAll("$", "").replaceAll(",", "").trim(),
    );

    if (!title || !category || !price || !description || !campus || !condition) {
      setError(t.fillFields);
      return;
    }

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      setError(t.validPrice);
      return;
    }

    setIsSubmitting(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error(t.mustLogin);
      }

      const createdListing = await createListingRecord(user.id, status, numericPrice);
      let uploadedImages = [];

      try {
        if (photos.length > 0) {
          uploadedImages = await uploadListingPhotos(user.id, createdListing.id, photos);

          const { error: imageRowsError } = await supabase
            .from("listing_images")
            .insert(
              uploadedImages.map((image, index) => ({
                listing_id: createdListing.id,
                image_url: image.imageUrl,
                storage_path: image.storagePath,
                position: index,
              })),
            );

          if (imageRowsError) {
            throw imageRowsError;
          }
        }
      } catch (assetError) {
        if (uploadedImages.length > 0) {
          await supabase.storage
            .from("listing-images")
            .remove(uploadedImages.map((image) => image.storagePath));
        }

        const { error: discardError } = await supabase.rpc(
          "discard_owned_listing_draft",
          { p_listing_id: createdListing.id },
        );

        if (discardError) {
          console.error("Failed to discard incomplete listing:", discardError.message);
        }
        throw assetError;
      }

      resetForm();
      toast.success(
        status === "draft"
          ? t.draftSaved
          : t.listingSubmittedForReview,
      );

      if (status === LISTING_APPROVAL_STATUS_VALUES.pendingReview) {
        router.push("/dashboard?tab=inactive");
        router.refresh();
      }
    } catch (submitError) {
      setError(
        isListingApprovalSetupMissing(submitError)
          ? t.listingApprovalSetupRequired
          : submitError.message || t.errorGeneric,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const tagPreview = ["New"];
  if (isNegotiable) {
    tagPreview.push("Negotiable");
  }

  const translatedCategoryOptions = React.useMemo(
    () =>
      CATEGORY_OPTIONS.map((option) => ({
        value: option,
        label: getTranslatedCategoryValue(option, t, language),
      })),
    [language, t]
  );

  const translatedConditionOptions = React.useMemo(
    () =>
      conditionOptions.map((option) => ({
        value: option,
        label: getTranslatedConditionLabel(option, t),
      })),
    [t]
  );

  const translatedTagPreview = tagPreview.map((tag) =>
    tag === "New" ? t.new : tag === "Negotiable" ? t.negotiable : tag
  );

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-3 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 md:gap-8">
        <Card className="rounded-[1.5rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border md:rounded-[2rem]">
          <CardHeader className="border-b border-zinc-200 px-4 py-4 dark:border-border sm:px-6 sm:py-5 md:px-8 md:py-7">
            <div className="flex flex-col gap-3 md:gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1 md:space-y-2">
                <CardTitle className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-foreground md:text-4xl">
                  {t.createListing}
                </CardTitle>
                <CardDescription className="max-w-2xl text-sm leading-5 text-zinc-600 dark:text-muted-foreground md:text-base md:leading-6">
                  {t.createListingDesc}
                </CardDescription>
              </div>

              <div className="w-full max-w-md rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100 md:rounded-2xl md:px-4 md:text-sm">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-semibold">{t.createListingRestrictionsTitle}</p>
                    <p className="leading-5 text-amber-800 dark:text-amber-200">
                      {t.createListingRestrictionsDescription}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-6 md:p-8">
            <div className="grid gap-5 pb-24 md:gap-8 md:pb-0 xl:grid-cols-[minmax(0,1fr)_minmax(288px,0.85fr)]">
              <FieldGroup className="gap-4 md:gap-5">
                <Field>
                  <FieldLabel>{t.title}</FieldLabel>
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={t.titlePlaceholder}
                  />
                </Field>

                <ListingCombobox
                  label={t.category}
                  placeholder={t.categoryPlaceholder}
                  value={category}
                  onValueChange={setCategory}
                  options={translatedCategoryOptions}
                  emptyLabel={t.noOptionFound}
                />

                <Field>
                  <FieldLabel>{t.price}</FieldLabel>
                  <Input
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="$0.00"
                    inputMode="decimal"
                  />
                </Field>

                <Field>
                  <FieldLabel>{t.description}</FieldLabel>
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                    className="h-32 min-h-32 max-h-72 md:h-40 md:min-h-40"
                    placeholder={t.descriptionPlaceholder}
                  />
                </Field>

                <ListingCombobox
                  label={t.condition}
                  placeholder={t.conditionPlaceholder}
                  value={condition}
                  onValueChange={setCondition}
                  options={translatedConditionOptions}
                  emptyLabel={t.noOptionFound}
                />
              </FieldGroup>

              <div className="flex flex-col gap-4 md:gap-6">
                <Card className="rounded-[1.25rem] border border-dashed border-zinc-300 bg-zinc-50 py-0 shadow-none dark:border-border dark:bg-muted/70 dark:ring-1 dark:ring-white/8 md:rounded-[1.75rem]">
                  <CardContent className="space-y-3 p-3 md:space-y-5 md:p-6">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "flex min-h-32 w-full flex-col items-center justify-center rounded-2xl border bg-white px-4 py-5 text-center transition dark:bg-card md:min-h-56 md:rounded-[1.5rem] md:px-6 md:py-10",
                        isDragActive
                          ? "border-zinc-950 ring-2 ring-zinc-950/10 dark:border-ring dark:ring-ring/20"
                          : "border-zinc-200 hover:border-zinc-400 dark:border-border dark:hover:border-ring"
                      )}
                      {...dropzoneProps}
                    >
                      <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-zinc-950 text-white dark:bg-primary dark:text-primary-foreground md:mb-4 md:size-14">
                        <ImagePlus className="size-5 md:size-6" />
                      </div>
                      <p className="text-base font-semibold text-zinc-950 dark:text-foreground md:text-lg">
                        {t.addPhotos}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-muted-foreground md:mt-2 md:text-sm">
                        {isDragActive ? t.dropImages : t.dragDrop}
                      </p>
                      {photos.length > 0 ? (
                        <p className="mt-2 text-xs font-medium text-zinc-700 dark:text-foreground md:mt-4 md:text-sm">
                          {photos.length} {photos.length === 1 ? t.selectedFileSingular : t.selectedFilePlural}
                        </p>
                      ) : null}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        const selectedFiles = Array.from(event.target.files ?? [])
                        if (selectedFiles.length === 0) return
                        appendPhotos(selectedFiles)
                        event.target.value = ""
                      }}
                    />
                    {photoError ? (
                      <p role="alert" className="text-sm text-red-600 dark:text-red-400">{photoError}</p>
                    ) : null}

                    {photoPreviews.length > 0 ? (
                      <div className="-mx-1 flex snap-x snap-mandatory flex-nowrap gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:gap-3 md:overflow-visible md:pb-0">
                        {(showAllPhotoPreviews ? photoPreviews : photoPreviews.slice(0, 4)).map((photo, index) => (
                          <ListingPhotoChip
                            key={photo.id}
                            compact
                            index={index}
                            imageUrl={photo.imageUrl}
                            alt={photo.alt}
                            onRemove={() => {
                              setPhotos((currentPhotos) =>
                                currentPhotos.filter((_, photoIndex) => photoIndex !== index),
                              );
                            }}
                          />
                        ))}
                        {photoPreviews.length > 4 ? (
                          <button
                            type="button"
                            onClick={() => setShowAllPhotoPreviews((isExpanded) => !isExpanded)}
                            className="flex size-16 shrink-0 snap-start items-center justify-center rounded-2xl border border-zinc-300 bg-zinc-100 px-1 text-center text-xs font-semibold leading-4 text-zinc-700 dark:border-border dark:bg-muted dark:text-foreground sm:size-20 sm:text-sm"
                            aria-expanded={showAllPhotoPreviews}
                            aria-label={showAllPhotoPreviews ? "Show fewer photo previews" : `${photoPreviews.length - 4} additional photos selected`}
                          >
                            {showAllPhotoPreviews ? "Show less" : `+${photoPreviews.length - 4} more`}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="rounded-[1.25rem] border-zinc-200 bg-zinc-50 py-0 shadow-none dark:bg-muted/70 dark:ring-1 dark:ring-white/8 md:rounded-[1.75rem]">
                  <CardContent className="space-y-3 p-3 md:space-y-5 md:p-6">
                    <ListingCombobox
                      label={t.campus}
                      placeholder={t.campusPlaceholder}
                      value={campus}
                      onValueChange={setCampus}
                      options={TORONTO_CAMPUS_OPTIONS}
                      emptyLabel={t.noOptionFound}
                    />

                    <Field orientation="horizontal" className="items-start rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-card md:rounded-2xl md:p-4">
                      <Checkbox
                        id="negotiable"
                        checked={isNegotiable}
                        onCheckedChange={(checked) => setIsNegotiable(Boolean(checked))}
                      />
                      <div className="space-y-1">
                        <FieldTitle>{t.negotiable}</FieldTitle>
                        <FieldDescription>{t.negotiableDesc}</FieldDescription>
                      </div>
                    </Field>

                    <div className="hidden rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-card md:block">
                      <div className="mb-3 flex items-center gap-2 text-zinc-900 dark:text-foreground">
                        <Sparkles className="size-4" />
                        <p className="text-sm font-semibold uppercase tracking-[0.18em]">
                          {t.tagPreview}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {translatedTagPreview.map((tag) => (
                          <Badge key={tag} variant="secondary" className="bg-zinc-100 text-zinc-800 dark:bg-muted dark:text-foreground">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-3 text-sm text-zinc-500 dark:text-muted-foreground">
                        {t.editTagPreviewDesc}
                      </p>
                    </div>

                    <div className="hidden rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-white/10 dark:bg-card dark:text-muted-foreground md:block">
                      <div className="mb-2 flex items-center gap-2 text-zinc-900 dark:text-foreground">
                        <Info className="size-4" />
                        <span className="font-medium">{t.recommendation}</span>
                      </div>
                      {t.editRecommendationDesc}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 mt-5 grid grid-cols-2 gap-2 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-border dark:bg-card/95 md:static md:mx-0 md:mt-8 md:flex md:flex-row md:flex-wrap md:items-center md:justify-end md:gap-3 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
              {error ? (
                <p role="alert" className="col-span-2 w-full text-sm text-red-600 md:mr-auto md:w-auto">{error}</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                disabled={isSubmitting}
                onClick={() => handleSubmit("draft")}
              >
                {t.saveDraft}
              </Button>
              <AlertDialog
                open={isSubmitWarningOpen}
                onOpenChange={handleSubmitWarningOpenChange}
              >
                <AlertDialogTrigger asChild>
                  <Button type="button" className="w-full md:w-auto" disabled={isSubmitting}>
                    {isSubmitting ? t.saving : t.submitForReview}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t.createListingWarningDialogTitle}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t.createListingWarningDialogDescription}
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <div className="space-y-1.5">
                        <p className="font-semibold">{t.createListingRestrictionsTitle}</p>
                        <p className="leading-5 text-amber-800 dark:text-amber-200">
                          {t.createListingRestrictionsDescription}
                        </p>
                      </div>
                    </div>
                  </div>

                  <label
                    htmlFor="create-listing-restrictions-confirm"
                    className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-background p-4 text-sm dark:border-border"
                  >
                    <Checkbox
                      id="create-listing-restrictions-confirm"
                      checked={hasConfirmedRestrictions}
                      onCheckedChange={(checked) => setHasConfirmedRestrictions(Boolean(checked))}
                    />
                    <span className="leading-5 text-foreground">
                      {t.createListingRestrictionsConfirmLabel}
                    </span>
                  </label>

                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isSubmitting}>{t.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={!hasConfirmedRestrictions || isSubmitting}
                      onClick={() => handleSubmit(LISTING_APPROVAL_STATUS_VALUES.pendingReview)}
                    >
                      {isSubmitting ? t.saving : t.createListingRestrictionsConfirmAction}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
