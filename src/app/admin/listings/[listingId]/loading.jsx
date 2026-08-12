import { AdminListingReviewSkeleton } from "@/components/skeletons/admin-dashboard-skeleton";

export default function AdminListingReviewLoading() {
  return (
    <main aria-busy="true" aria-label="Loading listing review" className="min-h-screen bg-zinc-100 px-5 pt-3 pb-5 dark:bg-background md:px-6 md:pt-3 md:pb-6 lg:px-7 lg:pt-4 lg:pb-7">
      <div className="mx-auto w-full max-w-[1280px]">
        <AdminListingReviewSkeleton />
      </div>
    </main>
  );
}
