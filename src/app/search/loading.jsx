import { ListingGridSkeleton } from "@/components/skeletons/listing-grid-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <main aria-busy="true" aria-label="Loading search results" className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-5 dark:bg-background md:p-8">
      <div className="mx-auto flex min-w-0 w-full max-w-[1440px] flex-col gap-6">
        <Skeleton className="h-11 w-full rounded-full md:max-w-xl" />
        <section className="rounded-3xl bg-card p-6 shadow-sm ring-1 ring-border">
          <Skeleton className="h-7 w-56" />
          <div className="mt-4 flex gap-2 overflow-hidden">
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
