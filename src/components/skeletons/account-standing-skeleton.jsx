import { Skeleton } from "@/components/ui/skeleton";

function MetricSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-3 shadow-sm md:px-4 md:py-4">
      <Skeleton className="h-2.5 w-20 max-w-full" />
      <Skeleton className="mt-2 h-7 w-10" />
    </div>
  );
}

function NoticeSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:rounded-3xl">
      <div className="flex items-center justify-between border-b border-border px-3.5 py-3 md:px-5 md:py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="size-5 rounded-md" />
      </div>
      <div className="space-y-3 px-3.5 py-3 md:px-5 md:py-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-14 rounded-xl" />
          ))}
        </div>
        <div className="flex gap-2 border-t border-border pt-3">
          <Skeleton className="h-10 w-28 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function AccountStandingSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-col gap-3 md:gap-5">
      <section className="rounded-2xl border border-border bg-card px-4 py-4 shadow-sm md:rounded-3xl md:px-6 md:py-6">
        <div className="flex items-start gap-3 md:gap-4">
          <Skeleton className="size-10 shrink-0 rounded-xl md:size-12 md:rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-2.5 w-28" />
            <Skeleton className="h-8 w-44 max-w-full" />
            <Skeleton className="h-3 w-full max-w-2xl" />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        {Array.from({ length: 4 }, (_, index) => <MetricSkeleton key={index} />)}
      </section>

      <section>
        <Skeleton className="mb-2 h-5 w-36" />
        <div className="grid gap-3 xl:grid-cols-2">
          <NoticeSkeleton />
          <NoticeSkeleton />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:rounded-3xl">
        <div className="border-b border-border px-3.5 py-3 md:px-5 md:py-4">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-2 h-3 w-3/4 max-w-lg" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-3 px-3.5 py-3 md:px-5">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
