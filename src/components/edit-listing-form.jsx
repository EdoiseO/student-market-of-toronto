"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Info, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/utils/supabase/client";
import { useLanguage } from "@/context/LanguageContext";
import { translations } from "@/lib/translations";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  ListingPhotoChip,
  useLocalPhotoPreviews,
} from "@/components/listing-photo-chip";
import { Textarea } from "@/components/ui/textarea";
import {
  getValidListingImageFiles,
  LISTING_IMAGE_MAX_COUNT,
  useFileDropzone,
} from "@/hooks/use-file-dropzone";
import { TORONTO_CAMPUS_OPTIONS } from "@/lib/campuses";
import {
  CATEGORY_OPTIONS,
  getTranslatedCategoryValue,
  normalizeCategoryValue,
} from "@/lib/categories";
import {
  LISTING_APPROVAL_STATUS_VALUES,
  isActiveListingEditReviewEnabled,
} from "@/lib/listing-approval";
import { getTranslatedConditionLabel } from "@/lib/search-listings";
import { cn } from "@/lib/utils";

const conditionOptions = ["New", "Like New", "Used"];

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

export function EditListingForm({ listing }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { language } = useLanguage();
  const t = translations[language];

  const [title, setTitle] = React.useState(listing.title ?? "");
  const [category, setCategory] = React.useState(
    normalizeCategoryValue(listing.category) || "Other"
  );
  const [price, setPrice] = React.useState(String(listing.price ?? ""));
  const [description, setDescription] = React.useState(listing.description ?? "");
  const [campus, setCampus] = React.useState(listing.location ?? "");
  const [condition, setCondition] = React.useState(listing.condition ?? "");
  const [isNegotiable, setIsNegotiable] = React.useState(
    listing.is_negotiable ?? false
  );
  const [photos, setPhotos] = React.useState(listing.listing_images ?? []);
  const [removedPhotos, setRemovedPhotos] = React.useState([]);
  const [newPhotos, setNewPhotos] = React.useState([]);
  const [showAllPhotoPreviews, setShowAllPhotoPreviews] = React.useState(false);
  const [photoError, setPhotoError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const fileInputRef = React.useRef(null);
  const originalPrice = Number(listing.price ?? 0);
  const newPhotoPreviews = useLocalPhotoPreviews(newPhotos);

  const appendNewPhotos = React.useCallback((selectedFiles) => {
    if (selectedFiles.length === 0) {
      return;
    }

    const validFiles = getValidListingImageFiles(selectedFiles);
    const availableSlots = Math.max(
      0,
      LISTING_IMAGE_MAX_COUNT - photos.length - newPhotos.length,
    );
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
      setNewPhotos((currentPhotos) => [...currentPhotos, ...acceptedFiles]);
    }
  }, [language, newPhotos.length, photos.length]);

  const { isDragActive, dropzoneProps } = useFileDropzone(appendNewPhotos);

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

  const tagPreview = [];
  if (isNegotiable) {
    tagPreview.push(t.negotiable);
  }

  async function cleanupNewUploads(uploadedPaths, insertedImageIds) {
    if (uploadedPaths.length > 0) {
      const { error: cleanupStorageError } = await supabase.storage
        .from("listing-images")
        .remove(uploadedPaths);
      if (cleanupStorageError) {
        console.error("Storage cleanup failed:", cleanupStorageError.message);
      }
    }

    if (insertedImageIds.length > 0) {
      const { error: cleanupRowsError } = await supabase
        .from("listing_images")
        .delete()
        .in("id", insertedImageIds);
      if (cleanupRowsError) {
        console.error("Row cleanup failed:", cleanupRowsError.message);
      }
    }
  }

  async function handleSave() {
    const normalizedTitle = title.trim();
    const normalizedCategory = category.trim();
    const normalizedDescription = description.trim();
    const normalizedCampus = campus.trim();
    const normalizedCondition = condition.trim();
    const numericPrice = Number.parseFloat(price);

    if (
      !normalizedTitle ||
      !normalizedCategory ||
      !normalizedDescription ||
      Number.isNaN(numericPrice) ||
      numericPrice < 0 ||
      !normalizedCondition
    ) {
      setError(t.fillFieldsValidPrice);
      return;
    }

    setLoading(true);
    setError("");

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      setError(authError?.message ?? t.mustLoginEdit);
      setLoading(false);
      return;
    }

    const nextPreviousPrice =
      numericPrice !== originalPrice ? originalPrice : listing.previous_price ?? null;
    const hasMeaningfulFieldChanges =
      normalizedTitle !== (listing.title ?? "").trim() ||
      normalizedCategory !== normalizeCategoryValue(listing.category) ||
      numericPrice !== Number(listing.price ?? 0) ||
      normalizedDescription !== (listing.description ?? "").trim() ||
      (normalizedCampus || null) !== (listing.location ?? null) ||
      normalizedCondition !== (listing.condition ?? "") ||
      isNegotiable !== Boolean(listing.is_negotiable);
    const hasMeaningfulPhotoChanges = newPhotos.length > 0 || removedPhotos.length > 0;
    const shouldResubmitActiveListing =
      listing.status === "active" &&
      isActiveListingEditReviewEnabled() &&
      (hasMeaningfulFieldChanges || hasMeaningfulPhotoChanges);

    const listingUpdateValues = {
      title: normalizedTitle,
      category: normalizedCategory,
      price: numericPrice,
      previous_price: nextPreviousPrice,
      description: normalizedDescription,
      location: normalizedCampus || null,
      condition: normalizedCondition,
      is_negotiable: isNegotiable,
    };

    if (shouldResubmitActiveListing) {
      Object.assign(listingUpdateValues, {
        status: LISTING_APPROVAL_STATUS_VALUES.pendingReview,
        submitted_for_review_at: new Date().toISOString(),
      });
    }

    const { error: updateError } = await supabase
      .from("listings")
      .update(listingUpdateValues)
      .eq("id", listing.id)
      .eq("seller_id", user.id);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    const uploadedPaths = [];
    const insertedImageIds = [];

    for (let index = 0; index < newPhotos.length; index += 1) {
      const file = newPhotos[index];
      const safeName = file.name
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
      const filePath = `${user.id}/${listing.id}/${Date.now()}-${index + 1}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("listing-images")
        .upload(filePath, file);

      if (uploadError) {
        await cleanupNewUploads(uploadedPaths, insertedImageIds);
        setError(uploadError.message);
        setLoading(false);
        return;
      }

      uploadedPaths.push(filePath);

      const {
        data: { publicUrl },
      } = supabase.storage.from("listing-images").getPublicUrl(filePath);

      const { data: insertedImage, error: imageInsertError } = await supabase
        .from("listing_images")
        .insert({
          listing_id: listing.id,
          image_url: publicUrl,
          storage_path: filePath,
          position: photos.length + index,
        })
        .select("id")
        .single();

      if (imageInsertError) {
        await cleanupNewUploads(uploadedPaths, insertedImageIds);
        setError(imageInsertError.message);
        setLoading(false);
        return;
      }

      insertedImageIds.push(insertedImage.id);
    }

    const finalPhotoOrder = [...photos.map((photo) => photo.id), ...insertedImageIds];

    if (finalPhotoOrder.length > 0) {
      const positionUpdates = await Promise.all(
        finalPhotoOrder.map((imageId, index) =>
          supabase.from("listing_images").update({ position: index }).eq("id", imageId)
        )
      );

      const failedPositionUpdate = positionUpdates.find(
        ({ error: positionError }) => positionError
      );

      if (failedPositionUpdate?.error) {
        await cleanupNewUploads(uploadedPaths, insertedImageIds);
        setError(failedPositionUpdate.error.message);
        setLoading(false);
        return;
      }
    }

    if (removedPhotos.length > 0) {
      const removedPhotoIds = removedPhotos.map((photo) => photo.id);
      const storagePaths = removedPhotos
        .map((photo) => photo.storage_path)
        .filter(Boolean);

      const { error: removeRowsError } = await supabase
        .from("listing_images")
        .delete()
        .in("id", removedPhotoIds);

      if (removeRowsError) {
        setError(removeRowsError.message);
        setLoading(false);
        return;
      }

      if (storagePaths.length > 0) {
        const { error: removeStorageError } = await supabase.storage
          .from("listing-images")
          .remove(storagePaths);

        if (removeStorageError) {
          console.error("Storage cleanup failed:", removeStorageError.message);
          setError(removeStorageError.message);
          setLoading(false);
          return;
        }
      }
    }

    setLoading(false);
    toast.success(
      shouldResubmitActiveListing ? t.listingResubmittedAfterEdit : t.listingUpdatedSuccess,
    );
    router.push(shouldResubmitActiveListing ? "/dashboard?tab=inactive" : `/listings/${listing.slug}`);
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-3 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 md:gap-8">
        <Card className="rounded-[1.5rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border md:rounded-[2rem]">
          <CardHeader className="border-b border-zinc-200 px-4 py-4 dark:border-border sm:px-6 sm:py-5 md:px-8 md:py-7">
            <CardTitle className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-foreground md:text-4xl">
              {t.editListing}
            </CardTitle>
            <CardDescription className="max-w-2xl text-sm leading-5 text-zinc-600 dark:text-muted-foreground md:text-base md:leading-6">
              {t.editListingDesc}
            </CardDescription>
          </CardHeader>

          <CardContent className="p-4 sm:p-6 md:p-8">
            {listing.status === LISTING_APPROVAL_STATUS_VALUES.rejected ? (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-5 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200 md:mb-6 md:rounded-[1.5rem] md:p-5 md:text-sm">
                <p className="font-semibold">{t.listingRejectedTitle}</p>
                <p className="mt-1.5 md:mt-2 md:leading-6">
                  {listing.moderation_feedback || t.listingRejectedDescription}
                </p>
              </div>
            ) : null}

            <div className="grid gap-5 md:gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(288px,0.85fr)]">
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
                    className="h-28 min-h-28 resize-y overflow-y-auto [field-sizing:fixed] md:h-40 md:min-h-40"
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
                      <p className="mt-1 text-xs text-zinc-500 dark:text-muted-foreground md:mt-2 md:text-sm">
                        {isDragActive ? t.dropImages : t.dragDrop}
                      </p>
                      {photos.length + newPhotos.length > 0 ? (
                        <p className="mt-2 text-xs font-medium text-zinc-700 dark:text-foreground md:mt-4 md:text-sm">
                          {photos.length + newPhotos.length} {t.filesAvailableLabel}
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
                        const selectedFiles = Array.from(event.target.files ?? []);
                        if (selectedFiles.length === 0) return;
                        appendNewPhotos(selectedFiles);
                        event.target.value = "";
                      }}
                    />
                    {photoError ? (
                      <p role="alert" className="text-sm text-red-600 dark:text-red-400">{photoError}</p>
                    ) : null}

                    {photos.length > 0 || newPhotoPreviews.length > 0 ? (
                      <div className="-mx-1 flex snap-x snap-mandatory flex-nowrap gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:gap-3 md:overflow-visible md:pb-0">
                        {photos.slice(0, showAllPhotoPreviews ? photos.length : 4).map((photo, index) => (
                          <ListingPhotoChip
                            key={photo.id}
                            compact
                            index={index}
                            imageUrl={photo.image_url}
                            alt={`${t.existingPhoto} ${index + 1}`}
                            onRemove={() => {
                              setRemovedPhotos((currentPhotos) => [...currentPhotos, photo]);
                              setPhotos((currentPhotos) =>
                                currentPhotos.filter((_, photoIndex) => photoIndex !== index)
                              );
                            }}
                          />
                        ))}
                        {newPhotoPreviews.slice(0, showAllPhotoPreviews ? newPhotoPreviews.length : Math.max(0, 4 - photos.length)).map((photo, index) => (
                          <ListingPhotoChip
                            key={photo.id}
                            compact
                            index={photos.length + index}
                            imageUrl={photo.imageUrl}
                            alt={photo.alt}
                            onRemove={() => {
                              setNewPhotos((currentPhotos) =>
                                currentPhotos.filter((_, photoIndex) => photoIndex !== index)
                              );
                            }}
                          />
                        ))}
                        {photos.length + newPhotoPreviews.length > 4 ? (
                          <button
                            type="button"
                            onClick={() => setShowAllPhotoPreviews((isExpanded) => !isExpanded)}
                            className="flex size-16 shrink-0 snap-start items-center justify-center rounded-2xl border border-zinc-300 bg-zinc-100 px-1 text-center text-xs font-semibold leading-4 text-zinc-700 dark:border-border dark:bg-muted dark:text-foreground sm:size-20 sm:text-sm"
                            aria-expanded={showAllPhotoPreviews}
                            aria-label={showAllPhotoPreviews ? "Show fewer photo previews" : `${photos.length + newPhotoPreviews.length - 4} additional photos selected`}
                          >
                            {showAllPhotoPreviews ? "Show less" : `+${photos.length + newPhotoPreviews.length - 4} more`}
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

                    <Field
                      orientation="horizontal"
                      className="items-start rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-card md:rounded-2xl md:p-4"
                    >
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
                      <div className="mb-2 flex items-center gap-2 text-zinc-900 dark:text-foreground md:mb-3">
                        <Sparkles className="size-4" />
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] md:text-sm md:tracking-[0.18em]">
                          {t.tagPreview}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {tagPreview.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="bg-zinc-100 text-zinc-800 dark:bg-muted dark:text-foreground"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-muted-foreground md:mt-3 md:text-sm">
                        {t.editTagPreviewDesc}
                      </p>
                    </div>

                    <div className="hidden rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-white/10 dark:bg-card dark:text-muted-foreground md:block">
                      <div className="mb-1.5 flex items-center gap-2 text-zinc-900 dark:text-foreground md:mb-2">
                        <Info className="size-4" />
                        <span className="font-medium">{t.recommendation}</span>
                      </div>
                      {t.editRecommendationDesc}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {error ? <p role="alert" className="mt-4 text-sm text-red-600 md:mt-6">{error}</p> : null}

            <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 mt-5 grid grid-cols-2 gap-2 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-border dark:bg-card/95 md:static md:mx-0 md:mt-8 md:flex md:flex-row md:flex-wrap md:items-center md:justify-end md:gap-3 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => router.back()}
                disabled={loading}
              >
                {t.cancel}
              </Button>
              <Button type="button" className="w-full md:w-auto" onClick={handleSave} disabled={loading}>
                {loading ? t.saving : t.saveChanges}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
