"use client";

import * as React from "react";
import { ImagePlus, Info, Sparkles } from "lucide-react";

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
import { CATEGORY_OPTIONS } from "@/lib/categories";
import { createClient } from "@/utils/supabase/client";

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

export function CreateListingForm() {
  const supabase = React.useMemo(() => createClient(), []);
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [campus, setCampus] = React.useState("");
  const [condition, setCondition] = React.useState("");
  const [isNegotiable, setIsNegotiable] = React.useState(false);
  const [photos, setPhotos] = React.useState([]);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const fileInputRef = React.useRef(null);

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
    setSuccess("");

    const numericPrice = Number.parseFloat(
      price.replaceAll("$", "").replaceAll(",", "").trim(),
    );

    if (!title || !category || !price || !description || !campus || !condition) {
      setError("Fill in all required listing fields before continuing.");
      return;
    }

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      setError("Enter a valid price.");
      return;
    }

    setIsSubmitting(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must be logged in to create a listing.");
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
      setSuccess(
        status === "draft"
          ? "Draft saved successfully."
          : "Listing submitted and is pending approval.",
      );
    } catch (submitError) {
      setError(submitError.message || "Something went wrong while creating the listing.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const tagPreview = ["New"];
  if (isNegotiable) {
    tagPreview.push("Negotiable");
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8">
        <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm">
          <CardHeader className="border-b border-zinc-200 px-8 py-7">
            <CardTitle className="text-4xl font-bold tracking-tight text-zinc-950">
              Create Listing
            </CardTitle>
            <CardDescription className="max-w-2xl text-base text-zinc-600">
              Add the main item details first. Photos, campus, condition, and
              tag preview are included here so the page reflects how the listing
              will look later in the marketplace.
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
                  <CardContent className="p-6">
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
                      {photos.length > 0 ? (
                        <p className="mt-4 text-sm font-medium text-zinc-700">
                          {photos.length} file{photos.length === 1 ? "" : "s"} selected
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
                        setPhotos(Array.from(event.target.files ?? []))
                      }
                    />
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

                    <Field orientation="horizontal" className="items-start rounded-2xl border border-zinc-200 bg-white p-4">
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
                        `New` is automatic. `Popular`, `Hot`, `Price Drop`, and
                        `Sold` should be derived later from listing activity or
                        edits.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                      <div className="mb-2 flex items-center gap-2 text-zinc-900">
                        <Info className="size-4" />
                        <span className="font-medium">Recommendation</span>
                      </div>
                      Add a `Location Details` field later if you want meetup
                      directions to be more specific than campus only.
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
              {error ? (
                <p className="mr-auto text-sm text-red-600">{error}</p>
              ) : null}
              {success ? (
                <p className="mr-auto text-sm text-green-600">{success}</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => handleSubmit("draft")}
              >
                Save Draft
              </Button>
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleSubmit("inactive")}
              >
                {isSubmitting ? "Saving..." : "Publish Listing"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
