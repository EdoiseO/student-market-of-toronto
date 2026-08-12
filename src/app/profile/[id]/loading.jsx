import { ProfileSkeleton } from "@/components/skeletons/profile-skeleton";

export default function PublicProfileLoading() {
  return (
    <main aria-busy="true" aria-label="Loading profile" className="min-h-screen bg-zinc-100 p-4 dark:bg-background md:p-6 lg:p-8">
      <div className="mx-auto w-full max-w-[1200px]">
        <ProfileSkeleton />
      </div>
    </main>
  );
}
