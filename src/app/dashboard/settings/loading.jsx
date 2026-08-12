import { Skeleton } from "@/components/ui/skeleton";

function SettingsRowSkeleton({ wide = false }) {
  return (
    <div className="flex min-h-[68px] items-center justify-between gap-4 px-4 py-3 md:px-6">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className={wide ? "h-4 w-44 max-w-full" : "h-4 w-32 max-w-full"} />
        <Skeleton className="h-3 w-full max-w-md" />
      </div>
      <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
    </div>
  );
}

export default function DashboardSettingsLoading() {
  return (
    <main aria-busy="true" aria-label="Loading account settings" className="min-h-screen bg-zinc-100 px-4 py-3 dark:bg-background md:p-5 lg:p-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 md:gap-4 lg:gap-6">
        <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border md:rounded-3xl md:p-8">
          <Skeleton className="h-7 w-32 md:h-9 md:w-48" />
          <Skeleton className="mt-2 h-3 w-3/4 md:mt-3 md:h-4" />
        </section>

        <section className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border md:rounded-3xl">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6 lg:py-5">
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <div className="grid h-[52px] grid-cols-3 gap-1 rounded-xl bg-muted p-1 lg:w-[340px]">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-11 rounded-lg" />
              ))}
            </div>
          </div>

          <div className="border-b border-border px-4 py-3 md:px-6 md:py-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-1.5 h-3 w-64 max-w-full" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }, (_, index) => (
              <SettingsRowSkeleton key={index} wide={index === 1} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-4 border-y border-border bg-muted/30 px-4 py-3 md:px-6">
            <Skeleton className="h-3 w-2/3 max-w-lg" />
            <Skeleton className="h-11 w-24 shrink-0 rounded-xl" />
          </div>

          <div className="border-b border-border px-4 py-3 md:px-6 md:py-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-1.5 h-3 w-60 max-w-full" />
          </div>
          <SettingsRowSkeleton wide />
          <div className="flex min-h-[64px] items-center border-t border-border px-4 py-3 md:px-6">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-52 max-w-full" />
            </div>
          </div>
          <div className="flex justify-end border-t border-border bg-muted/30 px-4 py-3 md:px-6">
            <Skeleton className="h-11 w-24 rounded-xl" />
          </div>
        </section>

        <section className="rounded-2xl border border-destructive/20 bg-card px-4 py-3 shadow-sm md:rounded-3xl md:px-6 md:py-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-full max-w-md" />
            </div>
            <Skeleton className="h-11 w-28 shrink-0 rounded-xl" />
          </div>
        </section>
      </div>
    </main>
  );
}
