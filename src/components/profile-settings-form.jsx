"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";

import { ProfileAvatarPreview } from "@/components/profile-avatar";
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
  const [isUpdatingAvatar, setIsUpdatingAvatar] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isMobileViewport, setIsMobileViewport] = React.useState(false);
  const requiresNameChange = initialProfile.requiresNameChange === true;

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

  const hasProfileChanges =
    currentNormalizedFirstName !== initialNormalizedFirstName ||
    currentNormalizedLastName !== initialNormalizedLastName ||
    currentNormalizedBio !== initialNormalizedBio;

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

  async function handleCustomAvatarChange(event) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type.startsWith("image/")) {
      toast.error(t.chooseImageFile);
      return;
    }

    if (selectedFile.size > 2 * 1024 * 1024) {
      toast.error(t.chooseImageUnder2MB);
      return;
    }

    setIsUpdatingAvatar(true);

    try {
      const existingStoragePath = extractProfileImageStoragePath(avatarUrl);
      const storagePath = buildProfileImageStoragePath(initialProfile.id, selectedFile.name);

      const { error: uploadError } = await supabase.storage
        .from(PROFILE_IMAGES_BUCKET)
        .upload(storagePath, selectedFile, {
          upsert: false,
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
      setIsAvatarPickerOpen(false);
      toast.success(t.customProfileImageUpdated);
      router.refresh();
    } catch (error) {
      console.error("Failed to save custom avatar image", error);
      toast.error(t.customProfileImageError);
    } finally {
      event.target.value = "";
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
      const { error: authUpdateError } = await supabase.auth.updateUser({
        data: {
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          ...(requiresNameChange ? { force_name_change: false } : {}),
        },
      });

      if (authUpdateError) {
        throw authUpdateError;
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      {requiresNameChange ? (
        <Card className="rounded-3xl border-amber-300 bg-amber-50 py-0 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <CardHeader className="px-6 py-5">
            <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
              {t.profileNameChangeRequiredTitle}
            </CardTitle>
            <CardDescription className="text-zinc-700 dark:text-zinc-200">
              {t.profileNameChangeRequiredDescription}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200 dark:bg-card dark:ring-border">
          <CardHeader className="border-b border-zinc-200 px-6 py-6 dark:border-border">
            <CardTitle className="text-2xl text-zinc-950 dark:text-foreground">{t.profilePhotoTitle}</CardTitle>
            <CardDescription>{t.profilePhotoDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 px-6 pt-4 pb-8 text-center">
            <Popover open={isAvatarPickerOpen} onOpenChange={setIsAvatarPickerOpen}>
              <PopoverAnchor asChild>
                <div className="relative flex aspect-square w-full max-w-[208px] items-center justify-center self-center rounded-[2rem] border border-dashed border-zinc-300 bg-zinc-50 dark:border-border dark:bg-muted/40">
                  <ProfileAvatarPreview
                    email={initialProfile.email}
                    name={`${firstName} ${lastName}`.trim()}
                    avatarPresetId={avatarPresetId}
                    avatarUrl={avatarUrl}
                    className="h-full w-full rounded-[calc(2rem-1px)]"
                    initialsClassName="text-6xl md:text-7xl"
                  />
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t.chooseProfilePictureStyle}
                      className="absolute bottom-2 right-2 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 text-white shadow-lg opacity-80 dark:bg-primary dark:text-primary-foreground"
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

                  <div className="grid grid-cols-5 gap-4">
                    {PROFILE_AVATAR_PRESETS.map((preset) => {
                      const isSelected = avatarPresetId === preset.id;

                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => saveAvatarPreset(preset.id)}
                          disabled={isUpdatingAvatar}
                          className={`flex aspect-square items-center justify-center rounded-full border-2 transition ${
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
                      className="flex aspect-square items-center justify-center rounded-full border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-700 transition hover:bg-zinc-100 dark:border-border dark:bg-muted/40 dark:text-foreground dark:hover:bg-muted"
                      aria-label={t.uploadCustomProfilePicture}
                    >
                      <Plus className="size-6" />
                    </button>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCustomAvatarChange}
                  />
              </PopoverContent>
            </Popover>
            <div className="space-y-2">
              <p className="text-sm font-medium text-zinc-950 dark:text-foreground">{initialProfile.email || t.studentAccount}</p>
              <p className="text-sm text-zinc-500 dark:text-muted-foreground">
                {t.profileColorsStorageNote}
              </p>
            </div>
            <div className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-left dark:border-border dark:bg-muted/40">
              <p className="text-sm font-medium text-zinc-950 dark:text-foreground">{t.school}</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-muted-foreground">
                {initialProfile.school || t.noSchoolOnFile}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200 dark:bg-card dark:ring-border">
          <CardHeader className="border-b border-zinc-200 px-6 py-6 dark:border-border">
            <CardTitle className="text-2xl text-zinc-950 dark:text-foreground">{t.personalDetailsTitle}</CardTitle>
            <CardDescription>{t.personalDetailsDescription}</CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-8">
            <FieldGroup className="gap-6">
              <div className="grid w-full gap-4 md:max-w-[50%]">
                <Field>
                  <FieldLabel htmlFor="profile-first-name">{t.firstName}</FieldLabel>
                  <Input
                    id="profile-first-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder={t.firstNamePlaceholder}
                    className="h-10 rounded-xl bg-white dark:bg-input/30"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="profile-last-name">{t.lastName}</FieldLabel>
                  <Input
                    id="profile-last-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder={t.lastNamePlaceholder}
                    className="h-10 rounded-xl bg-white dark:bg-input/30"
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="profile-description">{t.description}</FieldLabel>
                <Textarea
                  id="profile-description"
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  className="min-h-36 rounded-2xl bg-white dark:bg-input/30"
                  placeholder={t.profileBioPlaceholder}
                />
              </Field>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  className="rounded-xl px-5"
                  disabled={isSaving || !hasProfileChanges}
                >
                  {isSaving ? t.saving : t.saveProfile}
                </Button>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

    </form>
  );
}
