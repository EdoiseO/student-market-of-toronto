import { cookies } from "next/headers";

import { ProfileSettingsSkeleton } from "@/components/skeletons/profile-settings-skeleton";
import { translations } from "@/lib/translations";

export default async function DashboardProfileLoading() {
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;

  return (
    <main aria-busy="true" aria-label={t.loadingProfileSettings} className="min-h-screen bg-zinc-100 px-4 py-3 dark:bg-background md:p-8">
      <div className="mx-auto w-full max-w-[1280px]">
        <ProfileSettingsSkeleton label={t.loadingProfileSettings} />
      </div>
    </main>
  );
}
