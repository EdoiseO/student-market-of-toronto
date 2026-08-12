import { Skeleton } from "@/components/ui/skeleton";

function StatCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-8 w-1/3" />
    </div>
  );
}

function ListingRowSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-border p-4 last:border-b-0">
      <Skeleton className="size-14 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="hidden h-6 w-16 rounded-full sm:block" />
      <Skeleton className="size-11 shrink-0 rounded-md" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-col gap-6 p-4">
      <Skeleton className="h-7 w-40" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <Skeleton className="mt-2 h-5 w-32" />
      <div className="flex flex-col overflow-hidden rounded-xl border border-border">
        {Array.from({ length: 5 }, (_, index) => (
          <ListingRowSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
