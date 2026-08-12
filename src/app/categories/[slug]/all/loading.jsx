import { ListingGridSkeleton } from "@/components/skeletons/listing-grid-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function AllCategoryListingsLoading() {
  return (
    <main aria-busy="true" aria-label="Loading category listings" className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-6 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
        <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border md:p-8">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
        </section>
        <section className="rounded-3xl bg-muted/40 p-4 shadow-sm ring-1 ring-border md:p-6">
          <ListingGridSkeleton count={18} compact />
          <div className="mt-8 flex items-center justify-center gap-1">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="h-9 w-20 rounded-md" />
          </div>
        </section>
      </div>
    </main>
  );
}
