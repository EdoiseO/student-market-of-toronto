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
  FieldError,
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
import {
  parseListingRequiredFieldViolation,
  replayAmbiguousListingWrite,
  uploadListingImageBatch,
} from "@/lib/listing-integrity.mjs";
import {
  LISTING_WRITE_ACTIONS,
  abortOwnedListingWriteIntent,
  clearListingWriteJournal,
  drainOwnedListingImageCleanup,
  hashListingWriteSignature,
  listingWriteJournalKey,
  prepareListingWriteJournal,
  verifyOwnedListingReservedUpload,
} from "@/lib/listing-write-recovery.mjs";
import { getTranslatedConditionLabel } from "@/lib/search-listings";
import { focusFirstInvalidField } from "@/lib/focus-first-invalid-field";
import {
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_PRICE_MAX_CAD,
  countUnicodeCodePoints,
  normalizeListingPrice,
  normalizeWriteText,
  validateListingDraftFields,
  validateListingPublishFields,
} from "@/lib/write-field-contracts.mjs";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";

const conditionOptions = ["New", "Like New", "Used"];

function sanitizeFileName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ListingCombobox({
  id,
  label,
  placeholder,
  value,
  onValueChange,
  options,
  description,
  emptyLabel,
  error,
  requiredLabel = null,
}) {
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>
        {label}
        {requiredLabel ? (
          <span className="text-xs font-medium text-muted-foreground">{requiredLabel}</span>
        ) : null}
      </FieldLabel>
      <Combobox value={value} onValueChange={onValueChange}>
        <ComboboxInput
          id={id}
          placeholder={placeholder}
          required={Boolean(requiredLabel)}
          aria-required={Boolean(requiredLabel)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
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
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}

const LISTING_ERROR_TRANSLATION_KEYS = Object.freeze({
  title: "listingTitleRequired",
  category: "listingCategoryRequired",
  price: "listingPriceRequired",
  description: "listingDescriptionRequired",
  condition: "listingConditionRequired",
  campus: "listingCampusRequired",
  photos: "listingPhotoRequired",
});

function getListingFieldErrors(validation, t) {
  return Object.fromEntries(
    Object.keys(validation.errors).map((field) => [
      field,
      t[LISTING_ERROR_TRANSLATION_KEYS[field]] ?? t.listingRequiredFieldsUnavailable,
    ]),
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
  const [fieldErrors, setFieldErrors] = React.useState({});
  const [error, setError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isSubmitWarningOpen, setIsSubmitWarningOpen] = React.useState(false);
  const [hasConfirmedRestrictions, setHasConfirmedRestrictions] = React.useState(false);

  const fileInputRef = React.useRef(null);
  const formRef = React.useRef(null);
  const pendingWriteRef = React.useRef(null);
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
      setFieldErrors((current) => ({ ...current, photos: undefined }));
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
    setFieldErrors({});
    setShowAllPhotoPreviews(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(status) {
    setError("");
    const normalizedPriceInput = price.replaceAll("$", "").replaceAll(",", "").trim();
    const priceResult = normalizeListingPrice(normalizedPriceInput);
    const isPublishing = status === LISTING_APPROVAL_STATUS_VALUES.pendingReview;
    const validation = isPublishing
      ? validateListingPublishFields({
          title,
          category,
          price: normalizedPriceInput,
          description,
          condition,
          campus,
          photoCount: photos.length,
        })
      : validateListingDraftFields({ title });
    const normalizedDescription = isPublishing
      ? validation.values.description
      : normalizeWriteText(description, { emptyToNull: true });
    const normalizedCategory = isPublishing
      ? validation.values.category
      : normalizeWriteText(category, { emptyToNull: true });
    const normalizedCondition = isPublishing
      ? validation.values.condition
      : normalizeWriteText(condition, { emptyToNull: true });
    const normalizedCampus = isPublishing
      ? validation.values.campus
      : normalizeWriteText(campus, { emptyToNull: true });
    const validationErrors = getListingFieldErrors(validation, t);

    if (!priceResult.ok) {
      validationErrors.price = t.listingPriceRequired;
    }
    if (countUnicodeCodePoints(normalizedDescription ?? "") > LISTING_DESCRIPTION_MAX_LENGTH) {
      validationErrors.description = t.listingDescriptionRequired;
    }

    if (!validation.ok || !priceResult.ok || Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setError(t.listingValidationSummaryTitle);
      focusFirstInvalidField(formRef.current);
      return;
    }

    setFieldErrors({});

    setIsSubmitting(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error(t.mustLogin);
      }

      const writeSignature = JSON.stringify({
        isPublishing,
        title: validation.values.title,
        description: normalizedDescription,
        price: priceResult.value,
        category: normalizedCategory,
        condition: normalizedCondition,
        location: normalizedCampus,
        isNegotiable,
        photos: photos.map((photo) => ({
          name: photo.name,
          size: photo.size,
          type: photo.type,
          lastModified: photo.lastModified,
        })),
      });

      const signatureHash = await hashListingWriteSignature(writeSignature);
      const journalKey = listingWriteJournalKey(LISTING_WRITE_ACTIONS.create);
      const imageBucket = supabase.storage.from("listing-images");
      const prepared = await prepareListingWriteJournal({
        supabase,
        bucket: imageBucket,
        storage: globalThis.localStorage,
        key: journalKey,
        action: LISTING_WRITE_ACTIONS.create,
        signatureHash,
        isPublishing,
      });
      if (prepared.error) throw prepared.error;
      if (prepared.previousCompleted) {
        resetForm();
        pendingWriteRef.current = null;
        toast.success(isPublishing ? t.listingSubmittedForReview : t.draftSaved);
        router.push(isPublishing ? "/dashboard?tab=inactive" : "/dashboard?tab=draft");
        router.refresh();
        return;
      }

      const journal = prepared.entry;
      if (pendingWriteRef.current?.operationId !== journal.operationId) {
        pendingWriteRef.current = {
          operationId: journal.operationId,
          signatureHash,
          uploadState: {},
          uploadedImages: null,
          imageManifest: null,
        };
      }
      const pendingWrite = pendingWriteRef.current;

      const draftWrite = await replayAmbiguousListingWrite(() => supabase
        .rpc("commit_owned_listing_create_draft_intent", {
          p_operation_id: journal.operationId,
          p_signature_hash: signatureHash,
          p_title: validation.values.title,
          p_description: normalizedDescription,
          p_price: priceResult.value,
          p_category: normalizedCategory,
          p_condition: normalizedCondition,
          p_location: normalizedCampus,
          p_is_negotiable: isNegotiable,
        })
        .single());
      const { data: createdListing, error: draftError } = draftWrite;

      if (draftError || !createdListing) {
        throw draftError ?? new Error(t.listingRequiredFieldsUnavailable);
      }

      try {
        if (photos.length > 0) {
          if (!pendingWrite.uploadedImages) {
            const uploadPlan = photos.map((file, index) => {
              const safeName = sanitizeFileName(file.name) || `image-${index + 1}`;
              return {
                storagePath: `${user.id}/${createdListing.id}/${journal.operationId}-${index + 1}-${safeName}`,
                fileName: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
              };
            });
            const reservationWrite = await replayAmbiguousListingWrite(() => supabase.rpc(
              "reserve_owned_listing_image_uploads",
              {
                p_operation_id: journal.operationId,
                p_signature_hash: signatureHash,
                p_listing_id: createdListing.id,
                p_images: uploadPlan.map((image) => ({
                  storage_path: image.storagePath,
                  file_name: image.fileName,
                  mime_type: image.mimeType,
                  size_bytes: image.sizeBytes,
                })),
              },
            ));
            if (reservationWrite.error) throw reservationWrite.error;
            pendingWrite.uploadedImages = await uploadListingImageBatch({
              bucket: imageBucket,
              files: photos,
              uploadState: pendingWrite.uploadState,
              getStoragePath: (_file, index) => uploadPlan[index].storagePath,
              verifyExistingUpload: async (storagePath) => {
                const verified = await verifyOwnedListingReservedUpload({
                  supabase,
                  operationId: journal.operationId,
                  signatureHash,
                  storagePath,
                });
                if (verified.error) throw verified.error;
                return verified.data === true;
              },
            });
            pendingWrite.imageManifest = pendingWrite.uploadedImages.map((image, index) => ({
              id: crypto.randomUUID(),
              image_url: image.imageUrl,
              storage_path: image.storagePath,
              position: index,
            }));
          }
        }
      } catch (assetError) {
        const aborted = await abortOwnedListingWriteIntent(
          supabase,
          journal.operationId,
          signatureHash,
        );
        if (!aborted.error) {
          const cleanup = await drainOwnedListingImageCleanup({
            supabase,
            bucket: imageBucket,
          });
          if (!cleanup.error) {
            clearListingWriteJournal(globalThis.localStorage, journalKey, journal.operationId);
            pendingWriteRef.current = null;
          }
        }
        throw assetError;
      }

      const committed = await replayAmbiguousListingWrite(() => supabase.rpc(
        "commit_owned_listing_create_intent",
        {
          p_operation_id: journal.operationId,
          p_signature_hash: signatureHash,
          p_images: pendingWrite.imageManifest ?? [],
          p_is_publishing: isPublishing,
        },
      ));
      if (committed.error) {
        if (!committed.hadAmbiguousAttempt) {
          const aborted = await abortOwnedListingWriteIntent(
            supabase,
            journal.operationId,
            signatureHash,
          );
          if (!aborted.error) {
            const cleanup = await drainOwnedListingImageCleanup({
              supabase,
              bucket: imageBucket,
            });
            if (!cleanup.error) {
              clearListingWriteJournal(
                globalThis.localStorage,
                journalKey,
                journal.operationId,
              );
              pendingWriteRef.current = null;
            }
          }
        }
        throw committed.error;
      }

      const cleanup = await drainOwnedListingImageCleanup({
        supabase,
        bucket: imageBucket,
      });
      if (cleanup.error) throw cleanup.error;

      resetForm();
      clearListingWriteJournal(globalThis.localStorage, journalKey, journal.operationId);
      pendingWriteRef.current = null;
      toast.success(
        !isPublishing
          ? t.draftSaved
          : t.listingSubmittedForReview,
      );

      if (isPublishing) {
        router.push("/dashboard?tab=inactive");
        router.refresh();
      }
    } catch (submitError) {
      const requiredFields = parseListingRequiredFieldViolation(submitError);
      if (requiredFields.length > 0) {
        setFieldErrors(Object.fromEntries(requiredFields.map((field) => [
          field,
          t[LISTING_ERROR_TRANSLATION_KEYS[field]],
        ])));
        focusFirstInvalidField(formRef.current);
      }
      setError(
        isListingApprovalSetupMissing(submitError)
          ? t.listingApprovalSetupRequired
          : requiredFields.length > 0
            ? t.listingRequiredFieldsUnavailable
            : t.errorGeneric,
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
            <form ref={formRef} noValidate onSubmit={(event) => event.preventDefault()}>
              <p className="mb-4 text-xs text-muted-foreground md:mb-6 md:text-sm">
                {t.listingDraftMinimumHint}
              </p>
            <div className="grid gap-5 pb-24 md:gap-8 md:pb-0 xl:grid-cols-[minmax(0,1fr)_minmax(288px,0.85fr)]">
              <FieldGroup className="gap-4 md:gap-5">
                <Field data-invalid={Boolean(fieldErrors.title)}>
                  <FieldLabel htmlFor="listing-title">
                    {t.title}
                    <span className="text-xs font-medium text-muted-foreground">
                      {t.requiredFieldLabel}
                    </span>
                  </FieldLabel>
                  <Input
                    id="listing-title"
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setFieldErrors((current) => ({ ...current, title: undefined }));
                    }}
                    placeholder={t.titlePlaceholder}
                    required
                    aria-invalid={Boolean(fieldErrors.title)}
                    aria-describedby={fieldErrors.title ? "listing-title-error" : undefined}
                  />
                  <FieldError id="listing-title-error">{fieldErrors.title}</FieldError>
                </Field>

                <ListingCombobox
                  id="listing-category"
                  label={t.category}
                  placeholder={t.categoryPlaceholder}
                  value={category}
                  onValueChange={(value) => {
                    setCategory(value);
                    setFieldErrors((current) => ({ ...current, category: undefined }));
                  }}
                  options={translatedCategoryOptions}
                  emptyLabel={t.noOptionFound}
                  error={fieldErrors.category}
                  requiredLabel={t.requiredFieldLabel}
                />

                <Field data-invalid={Boolean(fieldErrors.price)}>
                  <FieldLabel htmlFor="listing-price">
                    {t.price}
                    <span className="text-xs font-medium text-muted-foreground">
                      {t.requiredFieldLabel}
                    </span>
                  </FieldLabel>
                  <Input
                    id="listing-price"
                    value={price}
                    onChange={(event) => {
                      setPrice(event.target.value);
                      setFieldErrors((current) => ({ ...current, price: undefined }));
                    }}
                    placeholder="$0.00"
                    inputMode="decimal"
                    min={0}
                    max={LISTING_PRICE_MAX_CAD}
                    required
                    aria-invalid={Boolean(fieldErrors.price)}
                    aria-describedby={fieldErrors.price ? "listing-price-error" : undefined}
                  />
                  <FieldError id="listing-price-error">{fieldErrors.price}</FieldError>
                </Field>

                <Field data-invalid={Boolean(fieldErrors.description)}>
                  <FieldLabel htmlFor="listing-description">
                    {t.description}
                    <span className="text-xs font-medium text-muted-foreground">
                      {t.requiredFieldLabel}
                    </span>
                  </FieldLabel>
                  <Textarea
                    id="listing-description"
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setFieldErrors((current) => ({ ...current, description: undefined }));
                    }}
                    rows={4}
                    className="h-32 min-h-32 max-h-72 md:h-40 md:min-h-40"
                    placeholder={t.descriptionPlaceholder}
                    required
                    aria-invalid={Boolean(fieldErrors.description)}
                    aria-describedby={fieldErrors.description ? "listing-description-error" : undefined}
                  />
                  <FieldError id="listing-description-error">{fieldErrors.description}</FieldError>
                </Field>

                <ListingCombobox
                  id="listing-condition"
                  label={t.condition}
                  placeholder={t.conditionPlaceholder}
                  value={condition}
                  onValueChange={(value) => {
                    setCondition(value);
                    setFieldErrors((current) => ({ ...current, condition: undefined }));
                  }}
                  options={translatedConditionOptions}
                  emptyLabel={t.noOptionFound}
                  error={fieldErrors.condition}
                  requiredLabel={t.requiredFieldLabel}
                />
              </FieldGroup>

              <div className="flex flex-col gap-4 md:gap-6">
                <Card className="rounded-[1.25rem] border border-dashed border-zinc-300 bg-zinc-50 py-0 shadow-none dark:border-border dark:bg-muted/70 dark:ring-1 dark:ring-white/8 md:rounded-[1.75rem]">
                  <CardContent
                    className="space-y-3 p-3 md:space-y-5 md:p-6"
                    data-field-invalid={Boolean(fieldErrors.photos)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-zinc-950 dark:text-foreground">
                        {t.addPhotos}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.requiredFieldLabel}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "relative flex min-h-32 w-full flex-col items-center justify-center rounded-2xl border bg-white px-4 py-5 text-center transition focus-within:ring-2 focus-within:ring-zinc-950/15 dark:bg-card dark:focus-within:ring-ring/25 md:min-h-56 md:rounded-[1.5rem] md:px-6 md:py-10",
                        isDragActive
                          ? "border-zinc-950 ring-2 ring-zinc-950/10 dark:border-ring dark:ring-ring/20"
                          : "border-zinc-200 hover:border-zinc-400 dark:border-border dark:hover:border-ring"
                      )}
                      {...dropzoneProps}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        required={photos.length === 0}
                        aria-required="true"
                        aria-invalid={Boolean(fieldErrors.photos)}
                        aria-describedby={fieldErrors.photos ? "listing-photos-error" : undefined}
                        aria-label={t.addPhotos}
                        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                        onChange={(event) => {
                          const selectedFiles = Array.from(event.target.files ?? [])
                          if (selectedFiles.length === 0) return
                          appendPhotos(selectedFiles)
                          event.target.value = ""
                        }}
                      />
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
                    </div>
                    {photoError ? (
                      <p role="alert" className="text-sm text-red-600 dark:text-red-400">{photoError}</p>
                    ) : null}
                    <FieldError id="listing-photos-error">{fieldErrors.photos}</FieldError>

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
                            aria-label={showAllPhotoPreviews
                              ? t.listingShowFewerPhotoPreviews
                              : t.listingAdditionalPhotosSelected.replace(
                                  "{count}",
                                  photoPreviews.length - 4,
                                )}
                          >
                            {showAllPhotoPreviews
                              ? t.listingShowLess
                              : t.listingMorePhotos.replace(
                                  "{count}",
                                  photoPreviews.length - 4,
                                )}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="rounded-[1.25rem] border-zinc-200 bg-zinc-50 py-0 shadow-none dark:bg-muted/70 dark:ring-1 dark:ring-white/8 md:rounded-[1.75rem]">
                  <CardContent className="space-y-3 p-3 md:space-y-5 md:p-6">
                    <ListingCombobox
                      id="listing-campus"
                      label={t.campus}
                      placeholder={t.campusPlaceholder}
                      value={campus}
                      onValueChange={(value) => {
                        setCampus(value);
                        setFieldErrors((current) => ({ ...current, campus: undefined }));
                      }}
                      options={TORONTO_CAMPUS_OPTIONS}
                      emptyLabel={t.noOptionFound}
                      error={fieldErrors.campus}
                      requiredLabel={t.requiredFieldLabel}
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
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
