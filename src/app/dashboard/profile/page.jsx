import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ProfileSettingsForm } from "@/components/profile-settings-form";
import { createClient } from "@/utils/supabase/server";

function normalizeMetadataText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export default async function DashboardProfilePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, school, avatar_preset_id, avatar_url, bio, is_public")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Failed to load dashboard profile:", profileError.message);
  }

  const profile = {
    id: user.id,
    firstName:
      existingProfile?.first_name ?? normalizeMetadataText(user.user_metadata?.first_name) ?? "",
    lastName:
      existingProfile?.last_name ?? normalizeMetadataText(user.user_metadata?.last_name) ?? "",
    school: existingProfile?.school ?? normalizeMetadataText(user.user_metadata?.school) ?? "",
    email: user.email ?? "",
    avatarPresetId: existingProfile?.avatar_preset_id ?? null,
    avatarUrl: existingProfile?.avatar_url ?? "",
    bio: existingProfile?.bio ?? "",
    isPublic: Boolean(existingProfile?.is_public),
  };

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-950">Profile</h1>
          <p className="mt-3 max-w-3xl text-base text-zinc-600">
            Manage the student details shown across your marketplace account. Name changes sync
            with your profile so seller identity stays consistent.
          </p>
        </section>

        <ProfileSettingsForm initialProfile={profile} />
      </div>
    </main>
  );
}
