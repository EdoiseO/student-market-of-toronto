"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";

import { ProfileAvatarPreview } from "@/components/profile-avatar";
import { ProfilePictureEditor } from "@/components/profile-picture-editor";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildProfileImageStoragePath,
  extractProfileImageStoragePath,
  PROFILE_IMAGES_BUCKET,
  PROFILE_AVATAR_PRESETS,
} from "@/lib/profile-avatar";
import {
  isSupportedProfileImageType,
  PROFILE_IMAGE_SOURCE_MAX_BYTES,
  readProfileImageDimensions,
  validateProfileImageDimensions,
} from "@/lib/profile-image-crop.mjs";

function normalizeProfileText(value) {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function ProfileSettingsForm({ initialProfile }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const fileInputRef = React.useRef(null);
  const { t } = useLanguage();

  const [firstName, setFirstName] = React.useState(initialProfile.firstName ?? "");
  const [lastName, setLastName] = React.useState(initialProfile.lastName ?? "");
  const [avatarPresetId, setAvatarPresetId] = React.useState(initialProfile.avatarPresetId ?? null);
  const [avatarUrl, setAvatarUrl] = React.useState(initialProfile.avatarUrl ?? "");
  const [bio, setBio] = React.useState(initialProfile.bio ?? "");
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = React.useState(false);
  const [avatarEditorSource, setAvatarEditorSource] = React.useState(null);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isMobileViewport, setIsMobileViewport] = React.useState(false);
  const [requiresNameChange, setRequiresNameChange] = React.useState(
    initialProfile.requiresNameChange === true,
  );

  React.useEffect(() => {
    let isActive = true;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (isActive) {
        setRequiresNameChange(user?.app_metadata?.force_name_change === true);
      }
    });

    return () => {
      isActive = false;
    };
  }, [supabase]);

  React.useEffect(() => {
    function syncIsMobileViewport() {
      setIsMobileViewport(window.innerWidth < 640);
    }

    syncIsMobileViewport();
    window.addEventListener("resize", syncIsMobileViewport);

    return () => {
      window.removeEventListener("resize", syncIsMobileViewport);
    };
  }, []);

  React.useEffect(() => {
    return () => {
      if (avatarEditorSource?.url) {
        URL.revokeObjectURL(avatarEditorSource.url);
      }
    };
  }, [avatarEditorSource]);

  const initials = [firstName, lastName]
    .filter(Boolean)
    .map((value) => value[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "SM";

  const initialNormalizedFirstName = normalizeProfileText(initialProfile.firstName ?? "");
  const initialNormalizedLastName = normalizeProfileText(initialProfile.lastName ?? "");
  const initialNormalizedBio = normalizeProfileText(initialProfile.bio ?? "");
  const currentNormalizedFirstName = normalizeProfileText(firstName);
  const currentNormalizedLastName = normalizeProfileText(lastName);
  const currentNormalizedBio = normalizeProfileText(bio);
  const hasNameChanges =
    currentNormalizedFirstName !== initialNormalizedFirstName ||
    currentNormalizedLastName !== initialNormalizedLastName;

  const hasProfileChanges =
    hasNameChanges || currentNormalizedBio !== initialNormalizedBio;

  async function saveAvatarPreset(nextPresetId) {
    setIsUpdatingAvatar(true);

    try {
      const existingStoragePath = extractProfileImageStoragePath(avatarUrl);

      const { error } = await supabase
        .from("profiles")
        .update({
          avatar_preset_id: nextPresetId,
          avatar_url: null,
        })
        .eq("id", initialProfile.id);

      if (error) {
        throw error;
      }

      if (existingStoragePath) {
        const { error: removeError } = await supabase.storage
          .from(PROFILE_IMAGES_BUCKET)
          .remove([existingStoragePath]);

        if (removeError) {
          console.error("Failed to remove previous profile image:", removeError.message);
        }
      }

      setAvatarPresetId(nextPresetId);
      setAvatarUrl("");
      setIsAvatarPickerOpen(false);
      toast.success(t.profilePhotoStyleUpdated);
      router.refresh();
    } catch (error) {
      console.error("Failed to update avatar preset", error);
      toast.error(t.profilePhotoStyleUpdateError);
    } finally {
      setIsUpdatingAvatar(false);
    }
  }

  function closeAvatarEditor() {
    setAvatarEditorSource(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleCustomAvatarChange(event) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!isSupportedProfileImageType(selectedFile.type)) {
      toast.error(t.chooseImageFile);
      event.target.value = "";
      return;
    }

    if (selectedFile.size > PROFILE_IMAGE_SOURCE_MAX_BYTES) {
      toast.error(t.chooseImageUnder10MB);
      event.target.value = "";
      return;
    }

    const sourceUrl = URL.createObjectURL(selectedFile);

    try {
      const { width, height } = await readProfileImageDimensions(sourceUrl);

      if (!validateProfileImageDimensions(width, height)) {
        throw new Error("Selected profile image dimensions exceed the editor limit.");
      }

      setAvatarEditorSource({
        file: selectedFile,
        url: sourceUrl,
      });
      setIsAvatarPickerOpen(false);
    } catch (error) {
      URL.revokeObjectURL(sourceUrl);
      event.target.value = "";
      console.error("Failed to open selected profile image", error);
      toast.error(t.profilePhotoCropOpenError);
    }
  }

  async function saveCustomAvatar(croppedFile) {
    if (croppedFile.size > 2 * 1024 * 1024) {
      toast.error(t.customProfileImageError);
      return;
    }

    setIsUpdatingAvatar(true);

    try {
      const existingStoragePath = extractProfileImageStoragePath(avatarUrl);
      const storagePath = buildProfileImageStoragePath(initialProfile.id, croppedFile.name);

      const { error: uploadError } = await supabase.storage
        .from(PROFILE_IMAGES_BUCKET)
        .upload(storagePath, croppedFile, {
          upsert: false,
          contentType: croppedFile.type,
          cacheControl: "3600",
        });

      if (uploadError) {
        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(PROFILE_IMAGES_BUCKET).getPublicUrl(storagePath);

      const { error } = await supabase
        .from("profiles")
        .update({
          avatar_preset_id: null,
          avatar_url: publicUrl,
        })
        .eq("id", initialProfile.id);

      if (error) {
        await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([storagePath]);
        throw error;
      }

      if (existingStoragePath) {
        const { error: removeError } = await supabase.storage
          .from(PROFILE_IMAGES_BUCKET)
          .remove([existingStoragePath]);

        if (removeError) {
          console.error("Failed to remove previous profile image:", removeError.message);
        }
      }

      setAvatarPresetId(null);
      setAvatarUrl(publicUrl);
      closeAvatarEditor();
      toast.success(t.customProfileImageUpdated);
      router.refresh();
    } catch (error) {
      console.error("Failed to save custom avatar image", error);
      toast.error(t.customProfileImageError);
    } finally {
      setIsUpdatingAvatar(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!hasProfileChanges || isSaving) {
      return;
    }

    const normalizedFirstName = currentNormalizedFirstName;
    const normalizedLastName = currentNormalizedLastName;
    const normalizedSchool = normalizeProfileText(initialProfile.school ?? "");
    const normalizedBio = currentNormalizedBio;

    if (requiresNameChange && (!normalizedFirstName || !normalizedLastName)) {
      toast.error(t.profileNameChangeRequiredError);
      return;
    }

    setIsSaving(true);

    try {
      if (hasNameChanges || requiresNameChange) {
        const nameResponse = await fetch("/api/account/name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: normalizedFirstName,
            lastName: normalizedLastName,
          }),
        });
        const namePayload = await nameResponse.json().catch(() => ({}));

        if (!nameResponse.ok) {
          throw new Error(namePayload?.error || t.profileUpdateError);
        }

        setRequiresNameChange(false);
      }

      const { error: profileUpsertError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: initialProfile.id,
            first_name: normalizedFirstName,
            last_name: normalizedLastName,
            school: normalizedSchool,
            bio: normalizedBio,
            avatar_preset_id: avatarPresetId,
            avatar_url: avatarUrl || null,
            is_public: initialProfile.isPublic ?? false,
          },
          { onConflict: "id" },
        );

      if (profileUpsertError) {
        throw profileUpsertError;
      }

      toast.success(t.profileUpdated);
      router.refresh();
    } catch (error) {
      console.error("Failed to update profile", error);
      toast.error(t.profileUpdateError);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 pb-3 md:gap-8 md:pb-0">
      {requiresNameChange ? (
        <Card className="rounded-2xl border-amber-300 bg-amber-50 py-0 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 md:rounded-3xl">
          <CardHeader className="px-4 py-4 md:px-6 md:py-5">
            <CardTitle className="text-lg text-zinc-950 dark:text-foreground md:text-xl">
              {t.profileNameChangeRequiredTitle}
            </CardTitle>
            <CardDescription className="text-zinc-700 dark:text-zinc-200">
              {t.profileNameChangeRequiredDescription}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-3 md:gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="rounded-2xl bg-white py-0 shadow-sm ring-zinc-200 dark:bg-card dark:ring-border md:rounded-3xl">
          <CardHeader className="border-b border-zinc-200 px-4 py-3 dark:border-border md:px-6 md:py-6">
            <CardTitle className="text-lg text-zinc-950 dark:text-foreground md:text-2xl">{t.profilePhotoTitle}</CardTitle>
            <CardDescription className="text-xs leading-5 md:text-sm">{t.profilePhotoDescription}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left md:flex md:flex-col md:gap-6 md:px-6 md:pb-8 md:pt-4 md:text-center">
            <Popover open={isAvatarPickerOpen} onOpenChange={setIsAvatarPickerOpen}>
              <PopoverAnchor asChild>
                <div className="relative flex size-16 items-center justify-center self-center rounded-full border border-dashed border-zinc-300 bg-zinc-50 dark:border-border dark:bg-muted/40 md:size-20 lg:size-[120px]">
                  <ProfileAvatarPreview
                    email={initialProfile.email}
                    name={`${firstName} ${lastName}`.trim()}
                    avatarPresetId={avatarPresetId}
                    avatarUrl={avatarUrl}
                    className="h-full w-full rounded-full"
                    initialsClassName="text-2xl md:text-3xl lg:text-5xl"
                  />
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t.chooseProfilePictureStyle}
                      className="absolute -bottom-1.5 -right-1.5 flex size-11 items-center justify-center rounded-full bg-zinc-950 text-white shadow-md dark:bg-primary dark:text-primary-foreground md:bottom-2 md:right-2"
                    >
                      <Plus className="size-5" />
                    </button>
                  </PopoverTrigger>
                </div>
              </PopoverAnchor>
              <PopoverContent
                side={isMobileViewport ? "bottom" : "right"}
                align="center"
                sideOffset={16}
                className="w-[min(20rem,calc(100vw-2rem))] rounded-[2rem] p-5 sm:w-[336px]"
              >
                  <PopoverHeader className="mb-2">
                    <PopoverTitle>{t.chooseProfilePicture}</PopoverTitle>
                    <PopoverDescription>
                      {t.chooseProfilePictureDescription}
                    </PopoverDescription>
                  </PopoverHeader>

                  <div className="grid grid-cols-4 gap-4">
                    {PROFILE_AVATAR_PRESETS.map((preset) => {
                      const isSelected = avatarPresetId === preset.id;

                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => saveAvatarPreset(preset.id)}
                          disabled={isUpdatingAvatar}
                          className={`flex min-h-11 min-w-11 aspect-square items-center justify-center rounded-full border-2 transition ${
                            isSelected
                              ? "border-zinc-950 ring-4 ring-zinc-200 dark:border-ring dark:ring-border"
                              : "border-transparent hover:scale-[1.02]"
                          }`}
                          aria-label={preset.label}
                        >
                          <div
                            className={`flex h-full w-full items-center justify-center rounded-full text-sm font-semibold text-white ${preset.className}`}
                          >
                            {initials}
                          </div>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUpdatingAvatar}
                      className="flex min-h-11 min-w-11 aspect-square items-center justify-center rounded-full border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-700 transition hover:bg-zinc-100 dark:border-border dark:bg-muted/40 dark:text-foreground dark:hover:bg-muted"
                      aria-label={t.uploadCustomProfilePicture}
                    >
                      <Plus className="size-6" />
                    </button>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    className="hidden"
                    onChange={handleCustomAvatarChange}
                  />
              </PopoverContent>
            </Popover>
            <div className="min-w-0 max-w-full space-y-0.5 md:space-y-2">
              <p className="truncate text-sm font-medium text-zinc-950 dark:text-foreground md:break-all">{initialProfile.email || t.studentAccount}</p>
              <p className="line-clamp-2 text-xs leading-4 text-zinc-500 dark:text-muted-foreground md:line-clamp-none md:text-sm md:leading-5">
                {t.profileColorsStorageNote}
              </p>
            </div>
            <div className="col-span-2 flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-left dark:border-border dark:bg-muted/40 md:block md:rounded-2xl md:p-4">
              <p className="text-xs font-medium text-zinc-500 dark:text-muted-foreground md:text-sm md:text-zinc-950 md:dark:text-foreground">{t.school}</p>
              <p className="truncate text-sm font-medium text-zinc-950 dark:text-foreground md:mt-1 md:font-normal md:text-zinc-600 md:dark:text-muted-foreground">
                {initialProfile.school || t.noSchoolOnFile}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl bg-white py-0 shadow-sm ring-zinc-200 dark:bg-card dark:ring-border md:rounded-3xl">
          <CardHeader className="border-b border-zinc-200 px-4 py-3 dark:border-border md:px-6 md:py-6">
            <CardTitle className="text-lg text-zinc-950 dark:text-foreground md:text-2xl">{t.personalDetailsTitle}</CardTitle>
            <CardDescription className="text-xs leading-5 md:text-sm">{t.personalDetailsDescription}</CardDescription>
          </CardHeader>
          <CardContent className="px-4 py-3 md:px-6 md:py-8">
            <FieldGroup className="gap-3 md:gap-6">
              <div className="grid w-full grid-cols-2 gap-3 md:max-w-[70%] md:gap-4">
                <Field>
                  <FieldLabel htmlFor="profile-first-name">{t.firstName}</FieldLabel>
                  <Input
                    id="profile-first-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder={t.firstNamePlaceholder}
                    className="rounded-xl bg-white dark:bg-input/30"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="profile-last-name">{t.lastName}</FieldLabel>
                  <Input
                    id="profile-last-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder={t.lastNamePlaceholder}
                    className="rounded-xl bg-white dark:bg-input/30"
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="profile-description">{t.description}</FieldLabel>
                <Textarea
                  id="profile-description"
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  rows={4}
                  className="h-32 min-h-32 max-h-72 rounded-xl bg-white dark:bg-input/30 md:h-36 md:min-h-36 md:rounded-2xl"
                  placeholder={t.profileBioPlaceholder}
                />
              </Field>

              <div className="-mx-4 flex justify-end border-t border-zinc-200 bg-white px-4 py-2 dark:border-border dark:bg-card md:mx-0 md:border-0 md:bg-transparent md:p-0">
                <Button
                  type="submit"
                  size="sm"
                  className="rounded-xl px-4"
                  disabled={isSaving || !hasProfileChanges}
                >
                  {isSaving ? t.saving : t.saveProfile}
                </Button>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      {avatarEditorSource ? (
        <ProfilePictureEditor
          open
          sourceUrl={avatarEditorSource.url}
          originalFileName={avatarEditorSource.file.name}
          isSaving={isUpdatingAvatar}
          onCancel={closeAvatarEditor}
          onSave={saveCustomAvatar}
        />
      ) : null}

    </form>
  );
}
