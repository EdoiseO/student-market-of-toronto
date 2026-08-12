import { Skeleton } from "@/components/ui/skeleton";

function AdminStatSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-5">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-8 rounded-lg" />
      </div>
      <Skeleton className="h-9 w-16" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

function AdminRowSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-4 border-b border-border p-4 last:border-b-0">
      <Skeleton className="size-10 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
      <Skeleton className="h-11 w-24 shrink-0 rounded-lg" />
    </div>
  );
}

export function AdminDashboardSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-col gap-6 p-4 md:p-6">
      <Skeleton className="h-8 w-52" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <AdminStatSkeleton key={index} />
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-36" />
        <div className="overflow-hidden rounded-xl border border-border">
          {Array.from({ length: 4 }, (_, index) => (
            <AdminRowSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
