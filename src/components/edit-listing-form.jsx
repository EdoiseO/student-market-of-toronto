"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Info, Sparkles, X } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

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
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_OPTIONS, normalizeCategoryValue } from "@/lib/categories";

const campusOptions = [
  "Toronto Metropolitan University",
  "University of Toronto",
  "York University",
  "George Brown College",
  "Humber Polytechnic",
  "OCAD University",
  "Seneca Polytechnic",
  "Centennial College",
];

const conditionOptions = ["New", "Like New", "Used"];

function ListingCombobox({
  label,
  placeholder,
  value,
  onValueChange,
  options,
  description,
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Combobox value={value} onValueChange={onValueChange}>
        <ComboboxInput placeholder={placeholder} />
        <ComboboxContent>
          <ComboboxEmpty>No option found.</ComboboxEmpty>
          <ComboboxList>
            {options.map((option) => (
              <ComboboxItem key={option} value={option}>
                {option}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

function ExistingPhotoChip({ index, onRemove }) {
  return (
    <div className="relative h-22 w-22 rounded-[1.4rem] border border-zinc-300 bg-zinc-100 text-zinc-600 shadow-[0_0_0_1px_rgba(24,24,27,0.03)]">
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white/95 text-zinc-700 shadow-sm transition hover:bg-zinc-950 hover:text-white"
        aria-label={`Delete photo ${index + 1}`}
      >
        <X className="size-3.5" />
      </button>
      <div className="flex h-full items-center justify-center text-2xl font-semibold">
        {index + 1}
      </div>
    </div>
  );
}

export function EditListingForm({ listing }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);

  const [title, setTitle] = React.useState(listing.title ?? "");
  const [category, setCategory] = React.useState(
    normalizeCategoryValue(listing.category) || "Other"
  );
  const [price, setPrice] = React.useState(String(listing.price ?? ""));
  const [description, setDescription] = React.useState(listing.description ?? "");
  const [campus, setCampus] = React.useState(listing.location ?? "");
  const [condition, setCondition] = React.useState(listing.condition ?? "");
  const [isNegotiable, setIsNegotiable] = React.useState(listing.is_negotiable ?? false);
  const [photos, setPhotos] = React.useState(listing.listing_images ?? []);
  const [removedPhotos, setRemovedPhotos] = React.useState([]);
  const [newPhotos, setNewPhotos] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const fileInputRef = React.useRef(null);
  const originalPrice = Number(listing.price ?? 0);

  const tagPreview = [];
  if (isNegotiable) {
    tagPreview.push("Negotiable");
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
      setError("Please complete the required fields with a valid price.");
      return;
    }

    setLoading(true);
    setError("");

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      setError(authError?.message ?? "You must be logged in to edit this listing.");
      setLoading(false);
      return;
    }

    const nextPreviousPrice =
      numericPrice !== originalPrice ? originalPrice : (listing.previous_price ?? null);

    // slug is intentionally excluded from this update.
    // If slug ever becomes mutable, update the redirect below to match.
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

    // NOTE: This save flow is still not fully atomic because Storage and database
    // writes are separate systems. Destructive photo deletion is deferred to the
    // end to reduce partial-save risk, but a full fix requires server-side orchestration.
    const finalPhotoOrder = [
      ...photos.map((photo) => photo.id),
      ...insertedImageIds,
    ];

    if (finalPhotoOrder.length > 0) {
      const positionUpdates = await Promise.all(
        finalPhotoOrder.map((imageId, index) =>
          supabase.from("listing_images").update({ position: index }).eq("id", imageId),
        ),
      );

      const failedPositionUpdate = positionUpdates.find(({ error: positionError }) => positionError);

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
    router.push(`/listings/${listing.slug}`);
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8">
        <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm">
          <CardHeader className="border-b border-zinc-200 px-8 py-7">
            <CardTitle className="text-4xl font-bold tracking-tight text-zinc-950">
              Edit Listing
            </CardTitle>
            <CardDescription className="max-w-2xl text-base text-zinc-600">
              Update the item details, manage the current photos, and adjust how
              the listing will appear in the marketplace.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-8">
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
              <FieldGroup>
                <Field>
                  <FieldLabel>Title</FieldLabel>
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="e.g. MacBook Air M1"
                  />
                </Field>

                <ListingCombobox
                  label="Category"
                  placeholder="Choose a category"
                  value={category}
                  onValueChange={setCategory}
                  options={CATEGORY_OPTIONS}
                />

                <Field>
                  <FieldLabel>Price</FieldLabel>
                  <Input
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="$0.00"
                    inputMode="decimal"
                  />
                </Field>

                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="min-h-40 resize-none"
                    placeholder="Describe the condition, included accessories, pickup details, and anything a student buyer should know."
                  />
                </Field>

                <ListingCombobox
                  label="Condition"
                  placeholder="Select condition"
                  value={condition}
                  onValueChange={setCondition}
                  options={conditionOptions}
                />
              </FieldGroup>

              <div className="flex flex-col gap-6">
                <Card className="rounded-[1.75rem] border border-dashed border-zinc-300 bg-zinc-50 py-0 shadow-none">
                  <CardContent className="space-y-5 p-6">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex min-h-56 w-full flex-col items-center justify-center rounded-[1.5rem] border border-zinc-200 bg-white px-6 py-10 text-center transition hover:border-zinc-400"
                    >
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-950 text-white">
                        <ImagePlus className="size-6" />
                      </div>
                      <p className="text-lg font-semibold text-zinc-950">
                        Add Listing Photos
                      </p>
                      {photos.length + newPhotos.length > 0 ? (
                        <p className="mt-4 text-sm font-medium text-zinc-700">
                          {photos.length + newPhotos.length} file
                          {photos.length + newPhotos.length === 1 ? "" : "s"} available
                        </p>
                      ) : null}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(event) =>
                        setNewPhotos(Array.from(event.target.files ?? []))
                      }
                    />

                    {photos.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {photos.map((photo, index) => (
                          <ExistingPhotoChip
                            key={photo.id}
                            index={index}
                            onRemove={() => {
                              setRemovedPhotos((currentPhotos) => [...currentPhotos, photo]);
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
                      label="Campus"
                      placeholder="Choose a meetup campus"
                      value={campus}
                      onValueChange={setCampus}
                      options={campusOptions}
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
                        <FieldTitle>Negotiable</FieldTitle>
                        <FieldDescription>
                          Turn this on if the seller is open to offers.
                        </FieldDescription>
                      </div>
                    </Field>

                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2 text-zinc-900">
                        <Sparkles className="size-4" />
                        <p className="text-sm font-semibold uppercase tracking-[0.18em]">
                          Tag Preview
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {tagPreview.map((tag) => (
                          <Badge key={tag} variant="secondary" className="bg-zinc-100 text-zinc-800">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-3 text-sm text-zinc-500">
                        `Sold` and `Price Drop` should update later from real
                        listing changes and dashboard actions.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                      <div className="mb-2 flex items-center gap-2 text-zinc-900">
                        <Info className="size-4" />
                        <span className="font-medium">Recommendation</span>
                      </div>
                      Keep the campus updated if the meetup spot changes after
                      publishing.
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
                Cancel
              </Button>
              <Button type="button" onClick={handleSave} disabled={loading}>
                {loading ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
