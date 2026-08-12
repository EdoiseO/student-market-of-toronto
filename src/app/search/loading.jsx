import { ListingGridSkeleton } from "@/components/skeletons/listing-grid-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <main aria-busy="true" aria-label="Loading search results" className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-5 dark:bg-background md:p-8">
      <div className="sticky top-16 z-40 -mx-4 -mt-5 border-b border-border bg-background/95 px-4 py-3 shadow-sm backdrop-blur md:hidden">
        <Skeleton className="h-11 w-full rounded-full" />
        <div className="-mx-4 mt-2 flex gap-2 overflow-hidden px-4 pb-1">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-24 shrink-0 rounded-full" />
          ))}
        </div>
      </div>

      <div className="mx-auto flex min-w-0 w-full max-w-[1440px] flex-col gap-6 pt-5 md:pt-0">
        <section className="rounded-2xl bg-card px-4 py-3.5 shadow-sm ring-1 ring-border md:rounded-[2rem] md:p-6">
          <div className="flex items-end justify-between gap-3 md:items-center">
            <div>
              <Skeleton className="h-2.5 w-16 md:h-3 md:w-20" />
              <Skeleton className="mt-1 h-5 w-28 md:mt-2 md:h-7 md:w-48" />
            </div>
            <Skeleton className="h-3.5 w-28 md:h-4 md:w-40" />
          </div>
          <div className="mt-4 hidden gap-2 overflow-hidden md:flex">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-24 shrink-0 rounded-full" />
            ))}
          </div>
        </section>
        <section className="rounded-3xl bg-muted/40 p-4 shadow-sm ring-1 ring-border md:p-8">
          <ListingGridSkeleton compact />
        </section>
      </div>
    </main>
  );
}
