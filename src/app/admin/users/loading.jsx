import { AdminUsersSkeleton } from "@/components/skeletons/admin-dashboard-skeleton";

export default function AdminUsersLoading() {
  return (
    <main aria-busy="true" aria-label="Loading user management" className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-7">
      <div className="mx-auto w-full max-w-[1280px] @container/main">
        <AdminUsersSkeleton />
      </div>
    </main>
  );
}
