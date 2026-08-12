import { ProfileSkeleton } from "@/components/skeletons/profile-skeleton";

export default function DashboardProfileLoading() {
  return (
    <main aria-busy="true" aria-label="Loading profile settings" className="min-h-screen bg-zinc-100 p-4 dark:bg-background md:p-8">
      <div className="mx-auto w-full max-w-[1280px] rounded-3xl bg-card py-4 shadow-sm ring-1 ring-border">
        <ProfileSkeleton />
      </div>
    </main>
  );
}
