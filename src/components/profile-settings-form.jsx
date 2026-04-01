"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { TORONTO_CAMPUS_OPTIONS } from "@/lib/campuses";
import { createClient } from "@/utils/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

const themeOptions = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
  { label: "Semi-dark", value: "semi-dark" },
];

function normalizeProfileText(value) {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function ProfileSettingsForm({ initialProfile }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);

  const [firstName, setFirstName] = React.useState(initialProfile.firstName ?? "");
  const [lastName, setLastName] = React.useState(initialProfile.lastName ?? "");
  const [school, setSchool] = React.useState(initialProfile.school ?? "");
  const [isSaving, setIsSaving] = React.useState(false);

  const initials = [firstName, lastName]
    .filter(Boolean)
    .map((value) => value[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "SM";

  const avatarUrl = initialProfile.email
    ? `https://avatar.vercel.sh/${encodeURIComponent(initialProfile.email)}`
    : "";

  async function handleSubmit(event) {
    event.preventDefault();

    const normalizedFirstName = normalizeProfileText(firstName);
    const normalizedLastName = normalizeProfileText(lastName);
    const normalizedSchool = normalizeProfileText(school);

    setIsSaving(true);

    try {
      const { error: authUpdateError } = await supabase.auth.updateUser({
        data: {
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          school: normalizedSchool,
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
              Your current avatar uses your account email for now.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 px-6 py-8 text-center">
            <div className="flex h-52 w-full items-center justify-center rounded-[2rem] border border-dashed border-zinc-300 bg-zinc-50">
              <Avatar className="size-28 border border-zinc-200 bg-white shadow-sm" size="lg">
                <AvatarImage src={avatarUrl} alt={`${firstName} ${lastName}`.trim() || "Profile avatar"} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-zinc-950">{initialProfile.email || "Student account"}</p>
              <p className="text-sm text-zinc-500">
                Profile photo uploads are not implemented yet, so this stays honest for now.
              </p>
            </div>
            <Button type="button" variant="outline" className="w-full rounded-xl" disabled>
              Change profile picture
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200">
          <CardHeader className="border-b border-zinc-200 px-6 py-6">
            <CardTitle className="text-2xl text-zinc-950">Account details</CardTitle>
            <CardDescription>
              Update the personal details that appear across your seller identity.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-8">
            <FieldGroup className="gap-6">
              <div className="grid gap-4 md:grid-cols-2">
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
                <FieldLabel htmlFor="profile-school">School</FieldLabel>
                <NativeSelect
                  id="profile-school"
                  value={school}
                  onChange={(event) => setSchool(event.target.value)}
                  className="w-full"
                >
                  <NativeSelectOption value="">Choose your school</NativeSelectOption>
                  {TORONTO_CAMPUS_OPTIONS.map((option) => (
                    <NativeSelectOption key={option} value={option}>
                      {option}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
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

      <div className="grid gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200">
          <CardHeader className="border-b border-zinc-200 px-6 py-6">
            <CardTitle className="text-2xl text-zinc-950">Preferences</CardTitle>
            <CardDescription>
              These controls match your concept layout and stay disabled until the underlying
              settings are implemented.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 px-6 py-8">
            <div className="space-y-3">
              <p className="text-sm font-medium text-zinc-950">Theme</p>
              <RadioGroup value="system" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" disabled>
                {themeOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500"
                  >
                    <RadioGroupItem value={option.value} disabled />
                    <span>{option.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
              <div>
                <p className="text-sm font-medium text-zinc-950">Notifications</p>
                <p className="mt-1 text-sm text-zinc-500">
                  Notification preferences are planned for a later pass.
                </p>
              </div>
              <Checkbox checked={false} disabled aria-label="Notifications coming soon" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl bg-white py-0 shadow-sm ring-zinc-200">
          <CardHeader className="border-b border-zinc-200 px-6 py-6">
            <CardTitle className="text-2xl text-zinc-950">Description</CardTitle>
            <CardDescription>
              Profile bios are not in the current schema yet, so this area is a placeholder.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-8">
            <Textarea
              value=""
              readOnly
              disabled
              className="min-h-44 rounded-2xl bg-zinc-50"
              placeholder="Tell other students about yourself, what you usually sell, or preferred meetup details."
            />
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
