import { Skeleton } from "@/components/ui/skeleton";

function MobileListingCardSkeleton() {
  return (
    <div className="rounded-[1.25rem] border border-border bg-card p-2.5 shadow-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        <Skeleton className="size-14 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-4/5" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        </div>
        <Skeleton className="size-11 shrink-0 rounded-full" />
      </div>
    </div>
  );
}

function DesktopListingRowSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-border p-4 last:border-b-0">
      <Skeleton className="h-12 w-16 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-6 w-20 rounded-full" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-9 w-24 rounded-lg" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-5 lg:px-7">
        <Skeleton className="h-9 w-44 lg:h-10" />
        <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
        <Skeleton className="mt-2 h-4 w-4/5 max-w-xl" />

        <div className="mt-3 grid grid-cols-2 gap-2 md:hidden">
          <Skeleton className="h-11 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
        </div>
      </div>

      <div className="space-y-5 p-4 pt-3 md:p-8 md:pt-3">
        <div className="space-y-3 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3 md:space-y-0">
          <div className="-mx-1 flex gap-2 overflow-hidden px-1 pb-1 md:hidden">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-24 shrink-0 rounded-full" />
            ))}
          </div>

          <div className="hidden flex-wrap gap-2 md:flex">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-20 rounded-xl" />
            ))}
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <Skeleton className="h-11 min-w-0 flex-1 rounded-xl" />
            <Skeleton className="h-11 w-28 shrink-0 rounded-xl" />
          </div>

          <div className="hidden items-center justify-end gap-2 md:flex">
            <Skeleton className="h-11 w-[170px] rounded-xl" />
            <Skeleton className="h-11 w-[200px] rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>

        <div className="space-y-2.5 md:hidden">
          {Array.from({ length: 3 }, (_, index) => (
            <MobileListingCardSkeleton key={index} />
          ))}
        </div>

        <div className="hidden overflow-hidden rounded-[1.75rem] border border-border md:block">
          <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-5 py-3.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="ml-auto h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
          {Array.from({ length: 5 }, (_, index) => (
            <DesktopListingRowSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
