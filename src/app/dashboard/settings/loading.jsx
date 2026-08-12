import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardSettingsLoading() {
  return (
    <main aria-busy="true" aria-label="Loading account settings" className="min-h-screen bg-zinc-100 p-4 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8">
        <section className="rounded-3xl bg-card p-6 shadow-sm ring-1 ring-border md:p-8">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="mt-3 h-4 w-3/4" />
        </section>
        <section className="space-y-6 rounded-3xl bg-card p-6 shadow-sm ring-1 ring-border md:p-8">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-4 border-b border-border pb-5 last:border-b-0 last:pb-0">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full max-w-md" />
              </div>
              <Skeleton className="h-11 w-20 shrink-0 rounded-full" />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
