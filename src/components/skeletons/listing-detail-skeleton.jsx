import { Skeleton } from "@/components/ui/skeleton";
import { ListingCardSkeleton } from "@/components/skeletons/listing-card-skeleton";

export function ListingDetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-col gap-4 md:gap-6">
      <div className="flex min-w-0 gap-2 overflow-hidden">
        <Skeleton className="h-[216px] w-[85vw] max-w-full shrink-0 rounded-xl min-[430px]:h-[232px] md:h-[300px] md:w-full" />
        <Skeleton className="h-[216px] w-[85vw] shrink-0 rounded-xl min-[430px]:h-[232px] md:hidden" />
      </div>

      <div className="flex min-w-0 flex-col gap-3 px-1 md:gap-4 md:px-0">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-6 w-3/4 md:h-7" />
        <Skeleton className="h-7 w-1/4 min-w-24 md:h-9" />

        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border p-3 md:p-4">
          <Skeleton className="size-12 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/3 min-w-24" />
            <Skeleton className="h-3 w-1/4 min-w-20" />
          </div>
          <Skeleton className="h-11 w-24 shrink-0 rounded-lg" />
        </div>

        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      </div>

      <div className="rounded-3xl bg-muted/40 p-4 ring-1 ring-border md:p-6">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
        <div className="-mx-2 mt-5 flex gap-3 overflow-hidden px-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="w-40 flex-none sm:w-44 md:w-48 lg:w-52">
              <ListingCardSkeleton compact />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
