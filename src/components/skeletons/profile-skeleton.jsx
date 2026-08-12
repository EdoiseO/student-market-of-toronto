import { ListingGridSkeleton } from "./listing-grid-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export function ProfileSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-col gap-3 md:gap-6">
      <div className="rounded-[1.5rem] bg-card p-3 ring-1 ring-border sm:p-6">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
          <Skeleton className="size-16 rounded-2xl sm:size-28 sm:rounded-3xl" />
          <div className="flex min-w-0 flex-col justify-center gap-2">
            <Skeleton className="h-4 w-14 rounded-full" />
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="flex items-center gap-2 rounded-xl border border-border p-2.5">
              <Skeleton className="size-4 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-3.5 w-12" />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>

      <div className="rounded-[1.5rem] bg-card p-3 ring-1 ring-border sm:p-6">
        <ListingGridSkeleton count={6} />
      </div>
    </div>
  );
}
