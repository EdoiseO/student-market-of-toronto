import { AdminDashboardSkeleton } from "@/components/skeletons/admin-dashboard-skeleton";

export default function AdminLoading() {
  return (
    <main aria-busy="true" aria-label="Loading moderation dashboard" className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-7">
      <div className="mx-auto w-full max-w-[1360px] @container/main">
        <AdminDashboardSkeleton />
      </div>
    </main>
  );
}
