import { AdminDashboardSkeleton } from "@/components/skeletons/admin-dashboard-skeleton";

export default function AdminUsersLoading() {
  return (
    <main aria-busy="true" aria-label="Loading user management" className="min-h-screen bg-zinc-100 p-4 dark:bg-background md:p-6 lg:p-7">
      <div className="mx-auto w-full max-w-[1280px] rounded-[2rem] bg-card shadow-sm ring-1 ring-border">
        <AdminDashboardSkeleton />
      </div>
    </main>
  );
}
