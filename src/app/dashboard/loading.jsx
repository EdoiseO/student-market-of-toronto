import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton";

export default function DashboardLoading() {
  return (
    <main aria-busy="true" aria-label="Loading dashboard" className="min-h-screen bg-zinc-100 p-4 dark:bg-background md:p-6 lg:p-7">
      <div className="mx-auto w-full max-w-[1360px] rounded-[2rem] bg-card shadow-sm ring-1 ring-border">
        <DashboardSkeleton />
      </div>
    </main>
  );
}
