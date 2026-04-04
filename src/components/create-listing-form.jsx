"use client";

import * as React from "react";
import { ImagePlus, Info, Sparkles } from "lucide-react";
import { toast } from "sonner";

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
import { ListingPhotoChip, useLocalPhotoPreviews } from "@/components/listing-photo-chip";
import { Textarea } from "@/components/ui/textarea";
import { useFileDropzone } from "@/hooks/use-file-dropzone";
import { TORONTO_CAMPUS_OPTIONS } from "@/lib/campuses";
import { CATEGORY_OPTIONS, getTranslatedCategoryValue } from "@/lib/categories";
import { useLanguage } from "@/context/LanguageContext";
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
  const [error, setError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const fileInputRef = React.useRef(null);
  const photoPreviews = useLocalPhotoPreviews(photos);

  const appendPhotos = React.useCallback((selectedFiles) => {
    if (selectedFiles.length === 0) {
      return;
    }

    setPhotos((currentPhotos) => [
      ...currentPhotos,
      ...selectedFiles,
    ]);
  }, []);

  const { isDragActive, dropzoneProps } = useFileDropzone(appendPhotos);

  function resetForm() {
    setTitle("");
    setCategory("");
    setPrice("");
    setDescription("");
    setCampus("");
    setCondition("");
    setIsNegotiable(false);
    setPhotos([]);
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

        await supabase.from("listings").delete().eq("id", createdListing.id);
        throw assetError;
      }

      resetForm();
      toast.success(
        status === "draft"
          ? t.draftSaved
          : t.listingPublished,
      );
    } catch (submitError) {
      setError(submitError.message || t.errorGeneric);
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
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
        <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm">
          <CardHeader className="border-b border-zinc-200 px-8 py-7">
            <CardTitle className="text-4xl font-bold tracking-tight text-zinc-950">
              {t.createListing}
            </CardTitle>
            <CardDescription className="max-w-2xl text-base text-zinc-600">
              {t.createListingDesc}
            </CardDescription>
          </CardHeader>

          <CardContent className="p-8">
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(288px,0.85fr)]">
              <FieldGroup>
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
                    className="min-h-40 resize-none"
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

              <div className="flex flex-col gap-6">
                <Card className="rounded-[1.75rem] border border-dashed border-zinc-300 bg-zinc-50 py-0 shadow-none">
                  <CardContent className="space-y-5 p-6">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "flex min-h-56 w-full flex-col items-center justify-center rounded-[1.5rem] border bg-white px-6 py-10 text-center transition",
                        isDragActive
                          ? "border-zinc-950 ring-2 ring-zinc-950/10"
                          : "border-zinc-200 hover:border-zinc-400"
                      )}
                      {...dropzoneProps}
                    >
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-950 text-white">
                        <ImagePlus className="size-6" />
                      </div>
                      <p className="text-lg font-semibold text-zinc-950">
                        Add Listing Photos
                      </p>
                      <p className="mt-2 text-sm text-zinc-500">
                        {isDragActive ? t.dropImages : t.dragDrop}
                      </p>
                      {photos.length > 0 ? (
                        <p className="mt-4 text-sm font-medium text-zinc-700">
                          {photos.length} {photos.length === 1 ? t.selectedFileSingular : t.selectedFilePlural}
                        </p>
                      ) : null}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        const selectedFiles = Array.from(event.target.files ?? [])
                        if (selectedFiles.length === 0) return
                        appendPhotos(selectedFiles)
                        event.target.value = ""
                      }}
                    />

                    {photoPreviews.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {photoPreviews.map((photo, index) => (
                          <ListingPhotoChip
                            key={photo.id}
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
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="rounded-[1.75rem] border-zinc-200 bg-zinc-50 py-0 shadow-none">
                  <CardContent className="space-y-5 p-6">
                    <ListingCombobox
                      label={t.campus}
                      placeholder={t.campusPlaceholder}
                      value={campus}
                      onValueChange={setCampus}
                      options={TORONTO_CAMPUS_OPTIONS}
                      emptyLabel={t.noOptionFound}
                    />

                    <Field orientation="horizontal" className="items-start rounded-2xl border border-zinc-200 bg-white p-4">
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

                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2 text-zinc-900">
                        <Sparkles className="size-4" />
                        <p className="text-sm font-semibold uppercase tracking-[0.18em]">
                          {t.tagPreview}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {translatedTagPreview.map((tag) => (
                          <Badge key={tag} variant="secondary" className="bg-zinc-100 text-zinc-800">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-3 text-sm text-zinc-500">
                        {t.editTagPreviewDesc}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                      <div className="mb-2 flex items-center gap-2 text-zinc-900">
                        <Info className="size-4" />
                        <span className="font-medium">{t.recommendation}</span>
                      </div>
                      {t.editRecommendationDesc}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
              {error ? (
                <p className="mr-auto text-sm text-red-600">{error}</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => handleSubmit("draft")}
              >
                {t.saveDraft}
              </Button>
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleSubmit("active")}
              >
                {isSubmitting ? t.saving : t.publish}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
