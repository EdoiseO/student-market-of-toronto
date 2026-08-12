import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardSettingsLoading() {
  return (
    <main aria-busy="true" aria-label="Loading account settings" className="min-h-screen bg-zinc-100 px-4 py-3 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 md:gap-8">
        <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border md:rounded-3xl md:p-8">
          <Skeleton className="h-7 w-40 md:h-9 md:w-56" />
          <Skeleton className="mt-2 h-3 w-3/4 md:mt-3 md:h-4" />
        </section>
        <section className="space-y-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border md:space-y-6 md:rounded-3xl md:p-8">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0 md:gap-4 md:pb-5">
              <div className="flex-1 space-y-1.5 md:space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full max-w-md" />
              </div>
              <Skeleton className="h-11 w-16 shrink-0 rounded-full md:w-20" />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
