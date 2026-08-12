import { ProfileSettingsSkeleton } from "@/components/skeletons/profile-settings-skeleton";

export default function DashboardProfileLoading() {
  return (
    <main aria-busy="true" aria-label="Loading profile settings" className="min-h-screen bg-zinc-100 px-4 py-3 dark:bg-background md:p-8">
      <div className="mx-auto w-full max-w-[1280px]">
        <ProfileSettingsSkeleton />
      </div>
    </main>
  );
}
