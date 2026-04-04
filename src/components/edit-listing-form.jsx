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
import { useFileDropzone } from "@/hooks/use-file-dropzone";
import { TORONTO_CAMPUS_OPTIONS } from "@/lib/campuses";
import {
  CATEGORY_OPTIONS,
  getTranslatedCategoryValue,
  normalizeCategoryValue,
} from "@/lib/categories";
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
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const fileInputRef = React.useRef(null);
  const originalPrice = Number(listing.price ?? 0);
  const newPhotoPreviews = useLocalPhotoPreviews(newPhotos);

  const appendNewPhotos = React.useCallback((selectedFiles) => {
    if (selectedFiles.length === 0) {
      return;
    }

    setNewPhotos((currentPhotos) => [...currentPhotos, ...selectedFiles]);
  }, []);

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

    const { error: updateError } = await supabase
      .from("listings")
      .update({
        title: normalizedTitle,
        category: normalizedCategory,
        price: numericPrice,
        previous_price: nextPreviousPrice,
        description: normalizedDescription,
        location: normalizedCampus || null,
        condition: normalizedCondition,
        is_negotiable: isNegotiable,
      })
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
    toast.success(t.listingUpdatedSuccess);
    router.push(`/listings/${listing.slug}`);
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
        <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm">
          <CardHeader className="border-b border-zinc-200 px-8 py-7">
            <CardTitle className="text-4xl font-bold tracking-tight text-zinc-950">
              {t.editListing}
            </CardTitle>
            <CardDescription className="max-w-2xl text-base text-zinc-600">
              {t.editListingDesc}
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
                        {t.addPhotos}
                      </p>
                      <p className="mt-2 text-sm text-zinc-500">
                        {isDragActive ? t.dropImages : t.dragDrop}
                      </p>
                      {photos.length + newPhotos.length > 0 ? (
                        <p className="mt-4 text-sm font-medium text-zinc-700">
                          {photos.length + newPhotos.length} {t.filesAvailableLabel}
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
                        const selectedFiles = Array.from(event.target.files ?? []);
                        if (selectedFiles.length === 0) return;
                        appendNewPhotos(selectedFiles);
                        event.target.value = "";
                      }}
                    />

                    {photos.length > 0 || newPhotoPreviews.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {photos.map((photo, index) => (
                          <ListingPhotoChip
                            key={photo.id}
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
                        {newPhotoPreviews.map((photo, index) => (
                          <ListingPhotoChip
                            key={photo.id}
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

                    <Field
                      orientation="horizontal"
                      className="items-start rounded-2xl border border-zinc-200 bg-white p-4"
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

                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2 text-zinc-900">
                        <Sparkles className="size-4" />
                        <p className="text-sm font-semibold uppercase tracking-[0.18em]">
                          {t.tagPreview}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {tagPreview.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="bg-zinc-100 text-zinc-800"
                          >
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

            {error ? <p className="mt-6 text-sm text-red-600">{error}</p> : null}

            <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={loading}
              >
                {t.cancel}
              </Button>
              <Button type="button" onClick={handleSave} disabled={loading}>
                {loading ? t.saving : t.saveChanges}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
