"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

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

  const [firstName, setFirstName] = React.useState(initialProfile.firstName ?? "");
  const [lastName, setLastName] = React.useState(initialProfile.lastName ?? "");
  const [avatarPresetId, setAvatarPresetId] = React.useState(initialProfile.avatarPresetId ?? null);
  const [avatarUrl, setAvatarUrl] = React.useState(initialProfile.avatarUrl ?? "");
  const [bio, setBio] = React.useState(initialProfile.bio ?? "");
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = React.useState(false);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  const initials = [firstName, lastName]
    .filter(Boolean)
    .map((value) => value[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "SM";

  async function saveAvatarPreset(nextPresetId) {
    setIsUpdatingAvatar(true);

    try {
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

      setAvatarPresetId(nextPresetId);
      setAvatarUrl("");
      setIsAvatarPickerOpen(false);
      toast.success("Profile photo style updated.");
      router.refresh();
    } catch (error) {
      console.error("Failed to update avatar preset", error);
      toast.error("We could not update your profile photo style.");
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
      toast.error("Please choose an image file.");
      return;
    }

    if (selectedFile.size > 2 * 1024 * 1024) {
      toast.error("Please choose an image under 2MB.");
      return;
    }

    setIsUpdatingAvatar(true);

    try {
      const fileReader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        fileReader.onload = () => resolve(fileReader.result);
        fileReader.onerror = () => reject(fileReader.error);
        fileReader.readAsDataURL(selectedFile);
      });

      if (typeof dataUrl !== "string") {
        throw new Error("Invalid file preview result");
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          avatar_preset_id: null,
          avatar_url: dataUrl,
        })
        .eq("id", initialProfile.id);

      if (error) {
        throw error;
      }

      setAvatarPresetId(null);
      setAvatarUrl(dataUrl);
      setIsAvatarPickerOpen(false);
      toast.success("Custom profile image updated.");
      router.refresh();
    } catch (error) {
      console.error("Failed to save custom avatar image", error);
      toast.error("We could not save that image.");
    } finally {
      event.target.value = "";
      setIsUpdatingAvatar(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const normalizedFirstName = normalizeProfileText(firstName);
    const normalizedLastName = normalizeProfileText(lastName);
    const normalizedSchool = normalizeProfileText(initialProfile.school ?? "");
    const normalizedBio = normalizeProfileText(bio);

    setIsSaving(true);

    try {
      const { error: authUpdateError } = await supabase.auth.updateUser({
        data: {
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
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

      toast.success("Profile updated.");
      router.refresh();
    } catch (error) {
      console.error("Failed to update profile", error);
      toast.error("We could not save your profile right now.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      <div className="grid gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200">
          <CardHeader className="border-b border-zinc-200 px-6 py-6">
            <CardTitle className="text-2xl text-zinc-950">Profile picture</CardTitle>
            <CardDescription>
              Choose a color style or add your own image.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 px-6 pt-4 pb-8 text-center">
            <Popover open={isAvatarPickerOpen} onOpenChange={setIsAvatarPickerOpen}>
              <PopoverAnchor asChild>
                <div className="relative flex aspect-square w-full max-w-[260px] items-center justify-center self-center rounded-[2rem] border border-dashed border-zinc-300 bg-zinc-50">
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
                      aria-label="Choose profile picture style"
                      className="absolute bottom-2 right-2 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 text-white shadow-lg opacity-80"
                    >
                      <Plus className="size-5" />
                    </button>
                  </PopoverTrigger>
                </div>
              </PopoverAnchor>
              <PopoverContent
                side="right"
                align="center"
                sideOffset={16}
                className="w-[360px] rounded-[2rem] p-5 sm:w-[420px]"
              >
                  <PopoverHeader className="mb-2">
                    <PopoverTitle>Choose profile picture</PopoverTitle>
                    <PopoverDescription>
                      Pick a color style or add your own image.
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
                              ? "border-zinc-950 ring-4 ring-zinc-200"
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
                      className="flex aspect-square items-center justify-center rounded-full border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-700 transition hover:bg-zinc-100"
                      aria-label="Upload a custom profile picture"
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

                  <p className="mt-3 text-sm text-zinc-500">
                    Uploaded images save to your profile.
                  </p>
              </PopoverContent>
            </Popover>
            <div className="space-y-2">
              <p className="text-sm font-medium text-zinc-950">{initialProfile.email || "Student account"}</p>
              <p className="text-sm text-zinc-500">
                Profile colors and custom images now save to your profile.
              </p>
            </div>
            <div className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-left">
              <p className="text-sm font-medium text-zinc-950">School</p>
              <p className="mt-1 text-sm text-zinc-600">
                {initialProfile.school || "No school on file yet."}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200">
          <CardHeader className="border-b border-zinc-200 px-6 py-6">
            <CardTitle className="text-2xl text-zinc-950">Personal details</CardTitle>
            <CardDescription>
              Update the personal details that appear across your seller identity.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-8">
            <FieldGroup className="gap-6">
              <div className="grid w-full gap-4 md:max-w-[50%]">
                <Field>
                  <FieldLabel htmlFor="profile-first-name">First name</FieldLabel>
                  <Input
                    id="profile-first-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder="Your first name"
                    className="h-10 rounded-xl bg-white"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="profile-last-name">Last name</FieldLabel>
                  <Input
                    id="profile-last-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder="Your last name"
                    className="h-10 rounded-xl bg-white"
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="profile-description">Description</FieldLabel>
                <Textarea
                  id="profile-description"
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  className="min-h-36 rounded-2xl bg-white"
                  placeholder="Tell other students about yourself, what you usually sell, or preferred meetup details."
                />
              </Field>

              <div className="flex justify-end">
                <Button type="submit" className="rounded-xl px-5" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save profile"}
                </Button>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

    </form>
  );
}
